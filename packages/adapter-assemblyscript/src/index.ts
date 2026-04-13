/**
 * @module @electron-message-bridge/adapter-assemblyscript
 *
 * Optional AssemblyScript / WebAssembly adapter for electron-message-bridge.
 *
 * Bridges AssemblyScript WASM module exports into typed IPC handlers that slot
 * directly into the existing `defineIpcApi` / `exposeApiToRenderer` pipeline.
 * This module has **zero mandatory runtime dependencies** — it uses the
 * standard `WebAssembly` global present in both Node.js ≥ 12 and Chromium.
 *
 * ## Quick start
 *
 * ```ts
 * // main.ts
 * import { createAssemblyScriptAdapter, asc } from '@electron-message-bridge/adapter-assemblyscript';
 * import { defineIpcApi } from 'electron-message-bridge';
 *
 * const schema = {
 *   add:       { params: ['i32', 'i32'] as const, result: 'i32' as const },
 *   greet:     { params: ['string']     as const, result: 'string' as const },
 *   hashBytes: { params: ['bytes']      as const, result: 'bytes' as const },
 * } satisfies AscSchema;
 *
 * const adapter = await createAssemblyScriptAdapter('./math.wasm', schema);
 * const api = defineIpcApi(adapter.handlers); // registers ipcMain.handle for each export
 *
 * // Dispose when the WASM module should be unloaded:
 * adapter.dispose();
 * api.dispose();
 * ```
 *
 * ## Type helper
 *
 * ```ts
 * import type { InferAscHandlers } from '@electron-message-bridge/adapter-assemblyscript';
 *
 * type MyApi = InferAscHandlers<typeof schema>;
 * // => { add: (a: number, b: number) => Promise<number>; greet: (s: string) => Promise<string>; ... }
 * ```
 *
 * ## AssemblyScript memory model
 *
 * AssemblyScript managed types (strings, ArrayBuffers) live in the module's
 * linear memory. When calling functions that accept or return managed types,
 * the adapter:
 * 1. Allocates memory via the module's `__new` export (or `__alloc` for older runtimes).
 * 2. Writes the value (UTF-16 for strings, raw bytes for buffers).
 * 3. Pins the pointer to prevent GC collection during the call.
 * 4. Calls the function.
 * 5. Reads the return value.
 * 6. Unpins and releases all allocated pointers.
 *
 * If the module does not export the runtime helpers (`__new`, `__pin`, `__unpin`,
 * `__getString`), only primitive types (`i32`, `u32`, `i64`, `u64`, `f32`, `f64`,
 * `bool`) and `void` are available. Pass `{ warnOnMissingRuntime: false }` to
 * suppress the startup warning.
 *
 * ## @assemblyscript/loader compatibility
 *
 * If you are already using `@assemblyscript/loader`, wrap the loaded module with
 * `wrapLoaderInstance` to make it compatible with this adapter:
 *
 * ```ts
 * import { instantiate } from '@assemblyscript/loader';
 * import { wrapLoaderInstance } from '@electron-message-bridge/adapter-assemblyscript';
 *
 * const { exports } = await instantiate(fs.readFileSync('./math.wasm'));
 * const adapter = createAssemblyScriptAdapter(wrapLoaderInstance(exports), schema);
 * ```
 */
import { readFile } from 'node:fs/promises';
import type { ApiHandlers } from 'electron-message-bridge';
import { ExportMissingError, RuntimeMissingError } from 'electron-message-bridge';
import type { NegotiablePlugin, AdapterManifest } from 'electron-message-bridge/plugins';
import { PROTOCOL_VERSION } from 'electron-message-bridge/plugins';

/** @internal Package manifest values for capability negotiation. */
const ADAPTER_NAME    = '@electron-message-bridge/adapter-assemblyscript' as const;
const ADAPTER_VERSION = '0.1.0' as const;

// ─── Value type descriptors ───────────────────────────────────────────────────

/**
 * Scalar WASM value types that map directly to JavaScript primitives.
 */
export type AscPrimitiveType =
  | 'i32' | 'u32'
  | 'i64' | 'u64'
  | 'f32' | 'f64'
  | 'bool';

/**
 * AssemblyScript managed object types that require memory helpers.
 * These cross the WASM boundary as pointer integers at runtime.
 */
export type AscManagedType =
  | 'string'       // AssemblyScript String — UTF-16 in linear memory
  | 'bytes';       // AssemblyScript ArrayBuffer — raw bytes in linear memory

/** All supported value types for WASM function descriptors. */
export type AscValueType = AscPrimitiveType | AscManagedType;

/** Return type descriptor — same as `AscValueType` plus `'void'`. */
export type AscReturnType = AscValueType | 'void';

// ─── Schema types ─────────────────────────────────────────────────────────────

/**
 * Describes the signature of a single WASM exported function.
 *
 * ```ts
 * const descriptor = {
 *   params: ['i32', 'string'] as const,
 *   result: 'string' as const,
 * } satisfies AscFnDescriptor;
 * ```
 */
export interface AscFnDescriptor<
  P extends readonly AscValueType[] = readonly AscValueType[],
  R extends AscReturnType = AscReturnType,
> {
  readonly params: P;
  readonly result: R;
}

/**
 * Maps export names to their `AscFnDescriptor` signatures.
 *
 * ```ts
 * const schema = {
 *   add:   { params: ['i32', 'i32'] as const, result: 'i32' as const },
 *   greet: { params: ['string']     as const, result: 'string' as const },
 * } satisfies AscSchema;
 * ```
 */
export type AscSchema = Record<string, AscFnDescriptor>;

// ─── Type inference ───────────────────────────────────────────────────────────

/** Maps an `AscValueType` to its JavaScript equivalent. */
export type JsOf<T extends AscValueType | 'void'> =
  T extends 'i32' | 'u32' | 'f32' | 'f64' ? number :
  T extends 'i64' | 'u64' ? bigint :
  T extends 'bool' ? boolean :
  T extends 'string' ? string :
  T extends 'bytes' ? Uint8Array :
  T extends 'void' ? void :
  never;

/** Maps a tuple of `AscValueType` to a tuple of their JS equivalents. */
type JsParamTuple<T extends readonly AscValueType[]> = {
  readonly [K in keyof T]: JsOf<T[K]>;
};

/** Infers the async handler signature for a single `AscFnDescriptor`. */
export type InferAscHandler<D extends AscFnDescriptor> =
  D extends AscFnDescriptor<infer P, infer R>
    ? P extends readonly AscValueType[]
      ? (...args: JsParamTuple<P>) => Promise<JsOf<R>>
      : never
    : never;

/**
 * Infers the full `ApiHandlers`-compatible map from an `AscSchema`.
 *
 * Use this to type-annotate `window.api` or pass to `ExtractRendererApi`.
 *
 * ```ts
 * type MyApi = InferAscHandlers<typeof schema>;
 * ```
 */
export type InferAscHandlers<S extends AscSchema> = {
  [K in keyof S]: InferAscHandler<S[K]>;
} & ApiHandlers;

// ─── Runtime exports interface ────────────────────────────────────────────────

/**
 * AssemblyScript runtime helper exports.
 *
 * These are emitted by the AssemblyScript compiler when using `--runtime full`
 * or `--runtime half`. The adapter uses them to manage managed-type lifetimes.
 *
 * Compatible with `@assemblyscript/loader` instance exports.
 */
export interface AscRuntimeExports {
  readonly memory: WebAssembly.Memory;
  /** Allocate a new managed object of the given runtime class ID and byte size. */
  readonly __new: (size: number, id: number) => number;
  /** Pin a pointer, preventing GC collection. Returns the pointer. */
  readonly __pin: (ptr: number) => number;
  /** Unpin a previously pinned pointer. */
  readonly __unpin: (ptr: number) => void;
  /** Run a full GC collection cycle. */
  readonly __collect: () => void;
  /** Read a managed string from linear memory. */
  readonly __getString: (ptr: number) => string;
  /** Write a new managed string into linear memory. Returns pointer. */
  readonly __newString: (str: string) => number;
  /** Read a managed ArrayBuffer from linear memory as a JS ArrayBuffer. */
  readonly __getArrayBuffer: (ptr: number) => ArrayBuffer;
  /** Write a new managed ArrayBuffer into linear memory. Returns pointer. */
  readonly __newArrayBuffer: (buf: ArrayBuffer) => number;
}

/**
 * Minimal shape of a WebAssembly instance's exports that this adapter requires.
 * Managed-type helpers are optional — their absence limits the available types.
 */
export type AscInstanceExports = Partial<AscRuntimeExports> & {
  readonly memory?: WebAssembly.Memory;
  readonly [key: string]: unknown;
};

// ─── Adapter options ──────────────────────────────────────────────────────────

/** Options for `createAssemblyScriptAdapter`. */
export interface AssemblyScriptAdapterOptions {
  /**
   * Import object passed to `WebAssembly.instantiate`.
   * Use this to provide host functions (e.g. `wasi_snapshot_preview1`, `env`).
   * @default `{ env: {} }`
   */
  imports?: WebAssembly.Imports;

  /**
   * Logger for adapter-level warnings and diagnostics.
   * @default `console`
   */
  logger?: Pick<Console, 'warn' | 'error'>;

  /**
   * Set to `false` to suppress the warning emitted when the WASM module does
   * not export AssemblyScript runtime helpers (`__new`, `__getString`, etc.).
   * Useful when you know the module only uses primitive types.
   * @default `true`
   */
  warnOnMissingRuntime?: boolean;
}

// ─── Adapter result ───────────────────────────────────────────────────────────

/**
 * The result of `createAssemblyScriptAdapter`.
 *
 * - `handlers` — a fully-typed `ApiHandlers` map, ready to pass to `defineIpcApi`.
 * - `instance` — the underlying `WebAssembly.Instance` for advanced use.
 * - `runtime` — the AssemblyScript runtime helpers (if available), or `null`.
 * - `dispose()` — releases the adapter's reference to the WASM instance.
 */
export interface AssemblyScriptAdapter<S extends AscSchema> {
  /** Typed async handlers — pass directly to `defineIpcApi(adapter.handlers)`. */
  readonly handlers: InferAscHandlers<S>;
  /** The raw WebAssembly instance. */
  readonly instance: WebAssembly.Instance;
  /**
   * AssemblyScript runtime helpers extracted from the WASM exports, or `null`
   * if the module was not compiled with a full AssemblyScript runtime.
   */
  readonly runtime: AscRuntimeExports | null;
  /**
   * Runs a GC collect cycle (if the runtime is available) and nulls the
   * internal reference to the WASM instance to aid GC of the adapter object.
   */
  dispose(): void;
}

// ─── Codec: JS → WASM encoding ───────────────────────────────────────────────

/** @internal */
function encodeArg(
  value: unknown,
  type: AscValueType,
  runtime: AscRuntimeExports | null,
  logger: Pick<Console, 'warn' | 'error'>,
  pinned: number[],
): unknown {
  switch (type) {
    case 'i32':
    case 'u32':
    case 'f32':
    case 'f64':
      return Number(value);

    case 'i64':
    case 'u64':
      return typeof value === 'bigint' ? value : BigInt(value as number);

    case 'bool':
      return value ? 1 : 0;

    case 'string': {
      if (runtime === null) {
        throw new RuntimeMissingError(['__newString', '__pin']);
      }
      const str = String(value);
      const ptr = runtime.__newString(str);
      const pinned_ = runtime.__pin(ptr);
      pinned.push(pinned_);
      return pinned_;
    }

    case 'bytes': {
      if (runtime === null) {
        throw new RuntimeMissingError(['__newArrayBuffer', '__pin']);
      }
      const buf = value instanceof Uint8Array
        ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
        : (value instanceof ArrayBuffer ? value : new Uint8Array(0).buffer);
      const ptr = runtime.__newArrayBuffer(buf);
      const pinned_ = runtime.__pin(ptr);
      pinned.push(pinned_);
      return pinned_;
    }

    default: {
      const _exhaustive: never = type;
      logger.warn('[@electron-message-bridge/adapter-assemblyscript] Unknown type:', _exhaustive);
      return value;
    }
  }
}

// ─── Codec: WASM → JS decoding ────────────────────────────────────────────────

/** @internal */
function decodeResult(
  raw: unknown,
  type: AscReturnType,
  runtime: AscRuntimeExports | null,
  logger: Pick<Console, 'warn' | 'error'>,
): unknown {
  switch (type) {
    case 'void':    return undefined;
    case 'i32':
    case 'u32':
    case 'f32':
    case 'f64':     return Number(raw);
    case 'i64':
    case 'u64':     return typeof raw === 'bigint' ? raw : BigInt(raw as number);
    case 'bool':    return Boolean(raw);

    case 'string': {
      if (runtime === null) {
        throw new RuntimeMissingError(['__getString']);
      }
      return runtime.__getString(raw as number);
    }

    case 'bytes': {
      if (runtime === null) {
        throw new RuntimeMissingError(['__getArrayBuffer']);
      }
      return new Uint8Array(runtime.__getArrayBuffer(raw as number));
    }

    default: {
      const _exhaustive: never = type;
      logger.warn('[@electron-message-bridge/adapter-assemblyscript] Unknown return type:', _exhaustive);
      return raw;
    }
  }
}

// ─── Runtime extraction ───────────────────────────────────────────────────────

const RUNTIME_EXPORTS = [
  '__new', '__pin', '__unpin', '__collect',
  '__getString', '__newString', '__getArrayBuffer', '__newArrayBuffer',
  'memory',
] as const;

/** @internal */
function extractRuntime(
  exports: AscInstanceExports,
  warnOnMissing: boolean,
  logger: Pick<Console, 'warn' | 'error'>,
): AscRuntimeExports | null {
  const missing = RUNTIME_EXPORTS.filter(k => !(k in exports));
  if (missing.length > 0) {
    if (warnOnMissing) {
      logger.warn(
        '[@electron-message-bridge/adapter-assemblyscript] WASM module is missing AssemblyScript runtime exports:',
        missing.join(', '),
        '— managed types (string, bytes) are unavailable. ' +
        'Compile with --runtime full or --runtime half. ' +
        'Pass { warnOnMissingRuntime: false } to suppress this warning.',
      );
    }
    return null;
  }
  return exports as unknown as AscRuntimeExports;
}

// ─── Handler builder ──────────────────────────────────────────────────────────

/** @internal */
function buildHandlers<S extends AscSchema>(
  exports: AscInstanceExports,
  schema: S,
  runtime: AscRuntimeExports | null,
  logger: Pick<Console, 'warn' | 'error'>,
): InferAscHandlers<S> {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const [name, descriptor] of Object.entries(schema) as [string, AscFnDescriptor][]) {
    const fn = exports[name];
    if (typeof fn !== 'function') {
      logger.warn(
        `[@electron-message-bridge/adapter-assemblyscript] WASM module does not export function "${name}". ` +
        `Calls to this handler will throw at runtime.`,
      );
      handlers[name] = async () => {
        throw new ExportMissingError(name);
      };
      continue;
    }

    handlers[name] = async (...jsArgs: unknown[]): Promise<unknown> => {
      const pinned: number[] = [];

      try {
        // Encode arguments
        const wasmArgs = descriptor.params.map((type, i) =>
          encodeArg(jsArgs[i], type, runtime, logger, pinned),
        );

        // Call the WASM export
        const rawResult = (fn as (...a: unknown[]) => unknown)(...wasmArgs);

        // Decode result
        return decodeResult(rawResult, descriptor.result, runtime, logger);
      } finally {
        // Unpin all managed objects allocated for this call
        if (runtime !== null) {
          for (const ptr of pinned) {
            try { runtime.__unpin(ptr); } catch { /* no-op */ }
          }
        }
      }
    };
  }

  return handlers as InferAscHandlers<S>;
}

// ─── WASM loading utilities ───────────────────────────────────────────────────

/**
 * Loads a WASM module from a file path, `Buffer`, `ArrayBuffer`, or a pre-built
 * `WebAssembly.Module`. Returns a `WebAssembly.Instance`.
 *
 * @internal
 */
async function loadWasm(
  source: string | Buffer | ArrayBuffer | WebAssembly.Module,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  if (source instanceof WebAssembly.Module) {
    const result = await WebAssembly.instantiate(source, imports);
    return result;
  }

  if (typeof source === 'string') {
    const buf = await readFile(source);
    const { instance } = await WebAssembly.instantiate(buf, imports);
    return instance;
  }

  const bytes = source instanceof ArrayBuffer ? source : (source as Buffer).buffer.slice(
    (source as Buffer).byteOffset,
    (source as Buffer).byteOffset + (source as Buffer).byteLength,
  );
  // Explicit cast resolves the overload ambiguity: ArrayBuffer is structurally
  // compatible with WebAssembly.Module (an empty interface), so without the cast
  // TypeScript might pick the wrong overload and type the result as `Instance`
  // instead of `WebAssemblyInstantiatedSource`.
  const { instance } = (await WebAssembly.instantiate(
    bytes as BufferSource, imports,
  )) as WebAssembly.WebAssemblyInstantiatedSource;
  return instance;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a typed adapter that wraps an AssemblyScript WASM module's exports
 * as async IPC handlers compatible with `defineIpcApi`.
 *
 * ## Loading from a file path (most common)
 *
 * ```ts
 * const adapter = await createAssemblyScriptAdapter('./math.wasm', {
 *   add:   { params: ['i32', 'i32'] as const, result: 'i32' as const },
 *   greet: { params: ['string']     as const, result: 'string' as const },
 * });
 * const api = defineIpcApi(adapter.handlers);
 * exposeApiToRenderer(api);
 * ```
 *
 * ## Loading from a Buffer (e.g. bundled WASM)
 *
 * ```ts
 * const wasmBuf = require('fs').readFileSync('./math.wasm');
 * const adapter = await createAssemblyScriptAdapter(wasmBuf, schema);
 * ```
 *
 * ## Using a pre-instantiated WebAssembly.Module
 *
 * ```ts
 * const mod = new WebAssembly.Module(wasmBytes);
 * const adapter = await createAssemblyScriptAdapter(mod, schema);
 * ```
 *
 * @param source  - Path to the `.wasm` file, a `Buffer`, `ArrayBuffer`,
 *                  pre-compiled `WebAssembly.Module`, or a `WebAssembly.Instance`.
 * @param schema  - Descriptor map of exported function names and their types.
 * @param options - Loader and adapter options.
 */
export async function createAssemblyScriptAdapter<S extends AscSchema>(
  source: string | Buffer | ArrayBuffer | WebAssembly.Module | WebAssembly.Instance,
  schema: S,
  options: AssemblyScriptAdapterOptions = {},
): Promise<AssemblyScriptAdapter<S>> {
  const logger = options.logger ?? console;
  const imports = options.imports ?? { env: {} };
  const warnOnMissing = options.warnOnMissingRuntime ?? true;

  // Resolve the WebAssembly.Instance.
  // We use a duck-type check (presence of `.exports`) rather than `instanceof`
  // because fake instances used in tests are plain objects cast via `as`, and
  // `instanceof WebAssembly.Instance` returns false for them at runtime.
  let instance: WebAssembly.Instance;
  if (source !== null && typeof source === 'object' && 'exports' in (source as object)) {
    instance = source as WebAssembly.Instance;
  } else {
    instance = await loadWasm(source as string | Buffer | ArrayBuffer | WebAssembly.Module, imports);
  }

  const exports = instance.exports as AscInstanceExports;
  const runtime = extractRuntime(exports, warnOnMissing, logger);
  const typedHandlers = buildHandlers(exports, schema, runtime, logger);

  let disposed = false;
  return {
    handlers: typedHandlers,
    instance,
    runtime,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        runtime?.__collect();
      } catch {
        // no-op — runtime may already be torn down
      }
    },
  };
}

// ─── @assemblyscript/loader compatibility wrapper ─────────────────────────────

/**
 * Wraps an instance produced by `@assemblyscript/loader`'s `instantiate` or
 * `instantiateSync` function, making it compatible with `createAssemblyScriptAdapter`
 * when passed as the `source` argument.
 *
 * ```ts
 * import { instantiate } from '@assemblyscript/loader';
 * import { wrapLoaderInstance } from '@electron-message-bridge/adapter-assemblyscript';
 *
 * const { exports } = await instantiate(wasmBuffer, { /* ... *\/ });
 * const adapter = await createAssemblyScriptAdapter(
 *   wrapLoaderInstance(exports),
 *   schema,
 *   { warnOnMissingRuntime: false },
 * );
 * ```
 *
 * @param loaderExports - The `exports` object from `@assemblyscript/loader`.
 */
export function wrapLoaderInstance(
  loaderExports: Record<string, unknown>,
): WebAssembly.Instance {
  // The loader exports already have the runtime helpers — create a fake
  // WebAssembly.Instance whose exports are the loader exports.
  return {
    exports: loaderExports as WebAssembly.Exports,
  } as WebAssembly.Instance;
}

// ─── AssemblyScriptPlugin ─────────────────────────────────────────────────────

import type { Plugin, PluginContext } from 'electron-message-bridge/plugins';
import { defineIpcApi } from 'electron-message-bridge';
import type { IpcApi } from 'electron-message-bridge';

/** Capabilities declared by `AssemblyScriptPlugin`. */
export interface AssemblyScriptCapabilities {
  /** The adapter name key used as the capability identifier. */
  [key: `assemblyscript:${string}`]: true;
}

/** Options for `AssemblyScriptPlugin`. */
export interface AssemblyScriptPluginOptions<S extends AscSchema> {
  /**
   * Unique name for this plugin instance. Used as the capability key
   * (`assemblyscript:<name>`) and in log messages.
   */
  name: string;

  /**
   * Path to the `.wasm` file, a `Buffer`, `ArrayBuffer`, or pre-compiled
   * `WebAssembly.Module`. Resolved during `init()`.
   */
  source: string | Buffer | ArrayBuffer | WebAssembly.Module;

  /**
   * AssemblyScript function schema — describes each exported function's
   * parameter types and return type.
   */
  schema: S;

  /** Passed through to `createAssemblyScriptAdapter`. */
  adapterOptions?: AssemblyScriptAdapterOptions;

  /**
   * Called after the WASM module is loaded and IPC handlers are registered.
   * Use this callback to store a reference to the typed `api` handle.
   */
  onReady?: (api: IpcApi<InferAscHandlers<S>>, adapter: AssemblyScriptAdapter<S>) => void;
}

/**
 * Lifecycle-managed plugin that loads an AssemblyScript WASM module, wires its
 * exports into `ipcMain`, and cleans up when the app shuts down.
 *
 * ```ts
 * import { PluginHost } from 'electron-message-bridge/plugins';
 * import { AssemblyScriptPlugin } from '@electron-message-bridge/adapter-assemblyscript';
 *
 * let mathApi: IpcApi<...>;
 *
 * const host = new PluginHost();
 * host.register(new AssemblyScriptPlugin({
 *   name: 'math',
 *   source: './math.wasm',
 *   schema: {
 *     add: { params: ['i32', 'i32'] as const, result: 'i32' as const },
 *   },
 *   onReady: (api) => { mathApi = api; },
 * }));
 *
 * await host.init();  // loads WASM, registers IPC handlers
 * await host.start();
 * ```
 */
export class AssemblyScriptPlugin<S extends AscSchema>
  implements Plugin<AssemblyScriptCapabilities>, NegotiablePlugin {
  readonly name: string;
  readonly capabilities: Record<string, true>;

  private readonly opts: AssemblyScriptPluginOptions<S>;
  private adapter: AssemblyScriptAdapter<S> | null = null;
  private api: IpcApi<InferAscHandlers<S>> | null = null;

  constructor(opts: AssemblyScriptPluginOptions<S>) {
    this.opts = opts;
    this.name = `assemblyscript:${opts.name}`;
    this.capabilities = { [`assemblyscript:${opts.name}`]: true };
  }

  /**
   * Returns the adapter's capability manifest for the pre-`init` handshake.
   *
   * The manifest is static — it does not depend on the WASM module being loaded
   * yet. The `capabilities.managedMemory` field is always `true` because the
   * adapter supports it when the module exports the runtime helpers. The actual
   * availability is determined at load time.
   */
  getManifest(): AdapterManifest {
    return {
      name: ADAPTER_NAME,
      version: ADAPTER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportsBinary: true,
      supportsStreaming: false,
      // maxPayloadBytes omitted — no adapter-level cap; limited by Node.js heap / Electron IPC
      capabilities: {
        wasmRuntime: 'assemblyscript',
        // Managed memory (strings, bytes) requires the --exportRuntime flag;
        // declared as supported here because the adapter handles both modes.
        managedMemory: true,
        schemaKeys: Object.keys(this.opts.schema),
      },
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.log(`Loading WASM module for "${this.opts.name}"...`);

    this.adapter = await createAssemblyScriptAdapter(
      this.opts.source,
      this.opts.schema,
      {
        logger: ctx.logger,
        ...this.opts.adapterOptions,
      },
    );

    this.api = defineIpcApi(this.adapter.handlers);
    this.opts.onReady?.(this.api, this.adapter);

    ctx.logger.log(
      `WASM module "${this.opts.name}" loaded. ` +
      `Registered IPC handlers: ${this.api._channels.join(', ')}`,
    );
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this.api) {
      this.api.dispose();
      ctx.logger.log(`IPC handlers for "${this.opts.name}" unregistered.`);
    }
  }

  async dispose(ctx: PluginContext): Promise<void> {
    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = null;
      ctx.logger.log(`WASM module "${this.opts.name}" disposed.`);
    }
    this.api = null;
  }
}

// ─── Convenience re-export ────────────────────────────────────────────────────

/**
 * Convenience namespace for concise schema authoring:
 *
 * ```ts
 * import { asc } from '@electron-message-bridge/adapter-assemblyscript';
 *
 * const schema = {
 *   add:   asc.fn(['i32', 'i32'], 'i32'),
 *   greet: asc.fn(['string'], 'string'),
 * };
 * ```
 */
export const asc = {
  /**
   * Shorthand for creating a typed function descriptor.
   *
   * @param params - Array of parameter type strings.
   * @param result - Return type string (or `'void'`).
   */
  fn<P extends readonly AscValueType[], R extends AscReturnType>(
    params: P,
    result: R,
  ): AscFnDescriptor<P, R> {
    return { params, result };
  },
} as const;
