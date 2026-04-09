/**
 * @module errors
 *
 * Typed interop error taxonomy for electron-ipc-helper.
 *
 * Every error thrown by the library carries a stable `code` string so callers
 * can branch on error type without relying on fragile message-string matching.
 *
 * ## Error codes
 *
 * | Code                    | Class                  | Thrown from              |
 * |-------------------------|------------------------|--------------------------|
 * | ERR_INVALID_PAYLOAD     | InvalidPayloadError    | defineIpcApi             |
 * | ERR_BRIDGE_TIMEOUT      | BridgeTimeoutError     | ChildProcessLifecycle    |
 * | ERR_MAX_RESTARTS        | MaxRestartsError       | ChildProcessLifecycle    |
 * | ERR_PLUGIN_CONFLICT     | PluginConflictError    | PluginHost.register      |
 * | ERR_EXPORT_MISSING      | ExportMissingError     | AssemblyScript adapter   |
 * | ERR_RUNTIME_MISSING     | RuntimeMissingError    | AssemblyScript adapter   |
 * | ERR_ADAPTER_MISSING     | AdapterMissingError    | PluginHost / adapters    |
 * | ERR_TRANSPORT_FAILURE   | TransportError         | IPC transport layer      |
 *
 * ## Usage
 *
 * ```ts
 * import { IpcHelperError, BridgeTimeoutError, ERR_BRIDGE_TIMEOUT } from 'electron-ipc-helper';
 *
 * try {
 *   await lifecycle.start();
 * } catch (err) {
 *   if (err instanceof BridgeTimeoutError) {
 *     console.error('Timed out after', err.timeoutMs, 'ms');
 *   }
 *   if (err instanceof IpcHelperError) {
 *     console.error('Code:', err.code); // always a stable string
 *   }
 * }
 * ```
 */

// ─── Error code literals ──────────────────────────────────────────────────────

export const ERR_INVALID_PAYLOAD   = 'ERR_INVALID_PAYLOAD'   as const;
export const ERR_INVALID_BRIDGE_PAYLOAD = 'ERR_INVALID_BRIDGE_PAYLOAD' as const;
export const ERR_BRIDGE_TIMEOUT    = 'ERR_BRIDGE_TIMEOUT'    as const;
export const ERR_MAX_RESTARTS      = 'ERR_MAX_RESTARTS'      as const;
export const ERR_PLUGIN_CONFLICT   = 'ERR_PLUGIN_CONFLICT'   as const;
export const ERR_EXPORT_MISSING    = 'ERR_EXPORT_MISSING'    as const;
export const ERR_RUNTIME_MISSING   = 'ERR_RUNTIME_MISSING'   as const;
export const ERR_ADAPTER_MISSING   = 'ERR_ADAPTER_MISSING'   as const;
export const ERR_TRANSPORT_FAILURE = 'ERR_TRANSPORT_FAILURE' as const;

/**
 * Union of all stable error codes produced by electron-ipc-helper.
 *
 * Use this type when you need to store or compare error codes in a type-safe way:
 *
 * ```ts
 * function logCode(code: IpcHelperErrorCode) { ... }
 * logCode(ERR_BRIDGE_TIMEOUT); // ✓
 * logCode('ERR_BRIDGE_TIMEOUT'); // ✓ — literal is assignable
 * logCode('ERR_SOMETHING_ELSE'); // ✗ — compile error
 * ```
 */
export type IpcHelperErrorCode =
  | typeof ERR_INVALID_PAYLOAD
  | typeof ERR_INVALID_BRIDGE_PAYLOAD
  | typeof ERR_BRIDGE_TIMEOUT
  | typeof ERR_MAX_RESTARTS
  | typeof ERR_PLUGIN_CONFLICT
  | typeof ERR_EXPORT_MISSING
  | typeof ERR_RUNTIME_MISSING
  | typeof ERR_ADAPTER_MISSING
  | typeof ERR_TRANSPORT_FAILURE;

// ─── Base class ───────────────────────────────────────────────────────────────

/**
 * Base class for all errors thrown by electron-ipc-helper.
 *
 * All subclasses set `name` to their class name and carry a stable `code`
 * string for programmatic branching without fragile message parsing.
 *
 * The optional `context` record can carry structured metadata (e.g. channel
 * name, timeout value) for logging and diagnostics.
 */
export class IpcHelperError extends Error {
  readonly code: IpcHelperErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: IpcHelperErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'IpcHelperError';
    this.code = code;
    this.context = Object.freeze({ ...context });

    // Restore prototype chain in environments that transpile class inheritance.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Specific error subclasses ────────────────────────────────────────────────

/**
 * Thrown when a handler passed to `defineIpcApi` is not a function.
 *
 * @example
 * ```ts
 * defineIpcApi({ ping: 'not-a-function' as any });
 * // → InvalidPayloadError: Handler for channel "ping" must be a function.
 * ```
 */
export class InvalidPayloadError extends IpcHelperError {
  /** The IPC channel whose handler value was invalid. */
  readonly channel: string;

  constructor(channel: string) {
    super(
      ERR_INVALID_PAYLOAD,
      `[electron-ipc-helper] Handler for channel "${channel}" must be a function.`,
      { channel },
    );
    this.name = 'InvalidPayloadError';
    this.channel = channel;
  }
}

/**
 * Thrown when a value passed to `assertBridgePayload` is not JSON-serialisable.
 *
 * @example
 * ```ts
 * assertBridgePayload(new Date(), 'saveSettings:input');
 * // → InvalidBridgePayloadError: Value at "saveSettings:input" is not a valid BridgePayload.
 * ```
 */
export class InvalidBridgePayloadError extends IpcHelperError {
  constructor(context?: string) {
    const where = context ?? '(unknown)';
    super(
      ERR_INVALID_BRIDGE_PAYLOAD,
      `[electron-ipc-helper] Value at "${where}" is not a valid BridgePayload (must be JSON-serialisable).`,
      { context: where },
    );
    this.name = 'InvalidBridgePayloadError';
  }
}

/**
 * Thrown when a `readyCheck` does not resolve within `readyTimeoutMs`.
 *
 * @example
 * ```ts
 * lifecycle.on('failed', (err) => {
 *   if (err instanceof BridgeTimeoutError) {
 *     console.error(`Timed out after ${err.timeoutMs}ms`);
 *   }
 * });
 * ```
 */
export class BridgeTimeoutError extends IpcHelperError {
  /** The timeout value (in milliseconds) that was exceeded. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      ERR_BRIDGE_TIMEOUT,
      `[electron-ipc-helper] Child process readyCheck timed out after ${timeoutMs}ms.`,
      { timeoutMs },
    );
    this.name = 'BridgeTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a child process exceeds its configured `maxRestarts` limit.
 *
 * @example
 * ```ts
 * lifecycle.on('failed', (err) => {
 *   if (err instanceof MaxRestartsError) {
 *     console.error(`Gave up after ${err.maxRestarts} restart attempts`);
 *   }
 * });
 * ```
 */
export class MaxRestartsError extends IpcHelperError {
  /** The maximum number of restarts that was configured. */
  readonly maxRestarts: number;

  constructor(maxRestarts: number) {
    super(
      ERR_MAX_RESTARTS,
      `[electron-ipc-helper] Child process exceeded max restarts (${maxRestarts}).`,
      { maxRestarts },
    );
    this.name = 'MaxRestartsError';
    this.maxRestarts = maxRestarts;
  }
}

/**
 * Thrown when two plugins declare the same capability key.
 *
 * @example
 * ```ts
 * host.register(pluginA); // declares capability "storage"
 * host.register(pluginB); // also declares "storage" → PluginConflictError
 * ```
 */
export class PluginConflictError extends IpcHelperError {
  /** The capability key that was declared by both plugins. */
  readonly capability: string;
  /** The name of the first plugin that claimed this capability. */
  readonly existing: string;
  /** The name of the plugin that tried to claim the same capability. */
  readonly incoming: string;

  constructor(capability: string, existing: string, incoming: string) {
    super(
      ERR_PLUGIN_CONFLICT,
      `[electron-ipc-helper] Plugin "${incoming}" declares capability "${capability}" ` +
      `which is already registered by plugin "${existing}". ` +
      `Remove one of the conflicting plugins.`,
      { capability, existing, incoming },
    );
    this.name = 'PluginConflictError';
    this.capability = capability;
    this.existing = existing;
    this.incoming = incoming;
  }
}

/**
 * Thrown when a required export is not found in a WebAssembly module's exports.
 *
 * @example
 * ```ts
 * // schema declares "multiply" but the .wasm doesn't export it
 * // → ExportMissingError: Export "multiply" not found in WebAssembly instance.
 * ```
 */
export class ExportMissingError extends IpcHelperError {
  /** The name of the export that was expected but not found. */
  readonly exportName: string;

  constructor(exportName: string) {
    super(
      ERR_EXPORT_MISSING,
      `[electron-ipc-helper] Export "${exportName}" not found in WebAssembly instance.`,
      { exportName },
    );
    this.name = 'ExportMissingError';
    this.exportName = exportName;
  }
}

/**
 * Thrown when AssemblyScript managed-memory functions are absent from the
 * WebAssembly module but the schema uses managed types (strings, arrays, etc.).
 *
 * @example
 * ```ts
 * // .wasm built without --exportRuntime but schema has params: ['string']
 * // → RuntimeMissingError: AssemblyScript runtime exports (__new, __pin, ...) not found.
 * ```
 */
export class RuntimeMissingError extends IpcHelperError {
  /** The runtime export names that were absent. */
  readonly missingExports: readonly string[];

  constructor(missingExports: string[]) {
    super(
      ERR_RUNTIME_MISSING,
      `[electron-ipc-helper] AssemblyScript runtime exports (${missingExports.join(', ')}) ` +
      `not found. Compile your module with --exportRuntime.`,
      { missingExports },
    );
    this.name = 'RuntimeMissingError';
    this.missingExports = Object.freeze([...missingExports]);
  }
}

/**
 * Thrown when a required adapter is not installed or not registered.
 *
 * @example
 * ```ts
 * // Trying to use AssemblyScript adapter without installing the package
 * // → AdapterMissingError: Adapter "@electron-ipc-helper/adapter-assemblyscript" is not available.
 * ```
 */
export class AdapterMissingError extends IpcHelperError {
  /** The adapter package name or identifier that was required. */
  readonly adapterName: string;

  constructor(adapterName: string) {
    super(
      ERR_ADAPTER_MISSING,
      `[electron-ipc-helper] Adapter "${adapterName}" is not available. ` +
      `Install it with: npm install ${adapterName}`,
      { adapterName },
    );
    this.name = 'AdapterMissingError';
    this.adapterName = adapterName;
  }
}

/**
 * Thrown when the IPC transport layer encounters an unrecoverable failure
 * (e.g. the renderer process was destroyed mid-call).
 *
 * @example
 * ```ts
 * try {
 *   await window.api.getUser('123');
 * } catch (err) {
 *   if (err instanceof TransportError) {
 *     // Renderer ↔ main channel failed
 *   }
 * }
 * ```
 */
export class TransportError extends IpcHelperError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(
      ERR_TRANSPORT_FAILURE,
      `[electron-ipc-helper] Transport failure: ${message}`,
      context,
    );
    this.name = 'TransportError';
  }
}
