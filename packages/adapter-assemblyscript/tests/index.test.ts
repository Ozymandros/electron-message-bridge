/**
 * Unit tests for @electron-ipc-helper/adapter-assemblyscript.
 *
 * No real `.wasm` file is needed. Tests inject a fake `WebAssembly.Instance`
 * whose exports are plain JavaScript functions. This isolates the adapter's
 * codec, type-inference, memory-management, and plugin wiring from real WASM.
 *
 * Coverage areas:
 * - Primitive type encoding / decoding (i32, u32, i64, f32, f64, bool)
 * - Managed type encoding / decoding (string, bytes) with mock runtime
 * - Missing-runtime: throws RuntimeMissingError when managed types are used without runtime
 * - Missing export handler (throws at call time)
 * - `asc.fn` schema shorthand
 * - `wrapLoaderInstance` compatibility shim
 * - `AssemblyScriptPlugin` lifecycle (init → stop → dispose)
 * - `AssemblyScriptPlugin` capability conflict detection
 * - Argument pinning / unpinning cleanup on success and on throw
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssemblyScriptAdapter,
  wrapLoaderInstance,
  AssemblyScriptPlugin,
  asc,
} from '../src/index.js';
import type { AscRuntimeExports, AscSchema } from '../src/index.js';
import { PluginHost, PluginConflictError } from 'electron-ipc-helper/plugins';
// The vitest alias maps 'electron' → tests/__mocks__/electron.ts
import { resetMocks } from 'electron';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function silentLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Build a mock WebAssembly.Memory with a small backing ArrayBuffer. */
function mockMemory(): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: 1 });
}

/**
 * Build a minimal mock AssemblyScript runtime.
 *
 * Strings are stored as a simple JS Map<ptr, string> so __getString / __newString
 * work without real linear memory. Same for ArrayBuffers.
 */
function mockRuntime(): AscRuntimeExports & {
  _strings: Map<number, string>;
  _buffers: Map<number, ArrayBuffer>;
  _pinned: Set<number>;
  _collected: boolean;
} {
  const strings = new Map<number, string>();
  const buffers = new Map<number, ArrayBuffer>();
  const pinned = new Set<number>();
  let nextPtr = 100;

  return {
    memory: mockMemory(),
    _strings: strings,
    _buffers: buffers,
    _pinned: pinned,
    _collected: false,
    __new: vi.fn((size: number, _id: number) => {
      const ptr = nextPtr;
      nextPtr += size + 8;
      return ptr;
    }),
    __pin: vi.fn((ptr: number) => {
      pinned.add(ptr);
      return ptr;
    }),
    __unpin: vi.fn((ptr: number) => {
      pinned.delete(ptr);
    }),
    __collect: vi.fn(function (this: { _collected: boolean }) {
      this._collected = true;
    }),
    __getString: vi.fn((ptr: number) => strings.get(ptr) ?? ''),
    __newString: vi.fn((str: string) => {
      const ptr = nextPtr;
      nextPtr += str.length * 2 + 8;
      strings.set(ptr, str);
      return ptr;
    }),
    __getArrayBuffer: vi.fn((ptr: number) => buffers.get(ptr) ?? new ArrayBuffer(0)),
    __newArrayBuffer: vi.fn((buf: ArrayBuffer) => {
      const ptr = nextPtr;
      nextPtr += buf.byteLength + 8;
      buffers.set(ptr, buf);
      return ptr;
    }),
  };
}

/** Builds a fake WebAssembly.Instance from a plain exports object. */
function fakeInstance(exports: Record<string, unknown>): WebAssembly.Instance {
  return { exports } as unknown as WebAssembly.Instance;
}

// ─── Primitive types ──────────────────────────────────────────────────────────

describe('createAssemblyScriptAdapter: primitive types', () => {
  it('i32 params and result — passes numbers through', async () => {
    const addFn = vi.fn((a: number, b: number) => a + b);
    const instance = fakeInstance({ add: addFn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.add(3, 4);
    expect(result).toBe(7);
    expect(addFn).toHaveBeenCalledWith(3, 4);
  });

  it('f64 params and result', async () => {
    const mulFn = vi.fn((a: number, b: number) => a * b);
    const instance = fakeInstance({ mul: mulFn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      mul: asc.fn(['f64', 'f64'], 'f64'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.mul(2.5, 4.0);
    expect(result).toBeCloseTo(10.0);
  });

  it('i64 params encode to BigInt', async () => {
    const fn = vi.fn((a: bigint) => a * 2n);
    const instance = fakeInstance({ double: fn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      double: asc.fn(['i64'], 'i64'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.double(21n);
    expect(result).toBe(42n);
    expect(fn).toHaveBeenCalledWith(21n);
  });

  it('bool param encodes to 0/1, result decoded to boolean', async () => {
    const fn = vi.fn((a: number) => (a ? 0 : 1));
    const instance = fakeInstance({ negate: fn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      negate: asc.fn(['bool'], 'bool'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    expect(await adapter.handlers.negate(true)).toBe(false);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('void result returns undefined', async () => {
    const fn = vi.fn(() => { /* no return */ });
    const instance = fakeInstance({ doSomething: fn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      doSomething: asc.fn([], 'void'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.doSomething();
    expect(result).toBeUndefined();
  });
});

// ─── Managed types ────────────────────────────────────────────────────────────

describe('createAssemblyScriptAdapter: managed types', () => {
  it('string param is allocated via __newString and pinned', async () => {
    const runtime = mockRuntime();
    const greetFn = vi.fn((ptr: number) => {
      // Return pointer to "Hello, World!" stored in mock runtime
      const result = runtime.__newString('Hello, World!');
      return result;
    });
    const instance = fakeInstance({ greet: greetFn, ...runtime });

    const adapter = await createAssemblyScriptAdapter(instance, {
      greet: asc.fn(['string'], 'string'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.greet('World');

    expect(runtime.__newString).toHaveBeenCalledWith('World');
    expect(runtime.__pin).toHaveBeenCalled();
    expect(runtime.__unpin).toHaveBeenCalled();
    expect(result).toBe('Hello, World!');
  });

  it('bytes param is encoded via __newArrayBuffer and pinned', async () => {
    const runtime = mockRuntime();
    const input = new Uint8Array([1, 2, 3, 4]);
    const fn = vi.fn((ptr: number) => ptr); // echo pointer back
    const instance = fakeInstance({ process: fn, ...runtime });

    const adapter = await createAssemblyScriptAdapter(instance, {
      process: asc.fn(['bytes'], 'bytes'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    await adapter.handlers.process(input);

    expect(runtime.__newArrayBuffer).toHaveBeenCalledTimes(1);
    expect(runtime.__pin).toHaveBeenCalled();
    expect(runtime.__unpin).toHaveBeenCalled();
  });

  it('pins are released even if the WASM function throws', async () => {
    const runtime = mockRuntime();
    const fn = vi.fn(() => { throw new Error('WASM error'); });
    const instance = fakeInstance({ crasher: fn, ...runtime });

    const adapter = await createAssemblyScriptAdapter(instance, {
      crasher: asc.fn(['string'], 'void'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    await expect(adapter.handlers.crasher('boom')).rejects.toThrow('WASM error');
    // Verify pin/unpin counts are equal (every pin was unpinned in finally)
    expect(runtime.__pin.mock.calls.length).toBe(runtime.__unpin.mock.calls.length);
  });
});

// ─── Missing runtime ──────────────────────────────────────────────────────────

describe('createAssemblyScriptAdapter: missing runtime', () => {
  it('warns when runtime exports are absent', async () => {
    const logger = silentLogger();
    const instance = fakeInstance({ add: (a: number, b: number) => a + b });

    await createAssemblyScriptAdapter(instance, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { logger });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing AssemblyScript runtime exports'),
      expect.any(String),
      expect.any(String),
    );
  });

  it('suppresses warning when warnOnMissingRuntime: false', async () => {
    const logger = silentLogger();
    const instance = fakeInstance({ add: (a: number, b: number) => a + b });

    await createAssemblyScriptAdapter(instance, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws RuntimeMissingError when encoding a string arg without runtime', async () => {
    const fn = vi.fn((_ptr: number) => 0);
    const instance = fakeInstance({ greet: fn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      greet: asc.fn(['string'], 'string'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    await expect(adapter.handlers.greet('hello')).rejects.toThrow(
      /RuntimeMissingError|runtime exports/i,
    );
  });

  it('throws RuntimeMissingError when encoding bytes without runtime', async () => {
    const fn = vi.fn((_ptr: number) => 0);
    const instance = fakeInstance({ process: fn });

    const adapter = await createAssemblyScriptAdapter(instance, {
      process: asc.fn(['bytes'], 'bytes'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    await expect(adapter.handlers.process(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /RuntimeMissingError|runtime exports/i,
    );
  });
});

// ─── Missing export ───────────────────────────────────────────────────────────

describe('createAssemblyScriptAdapter: missing export', () => {
  it('warns on construction when export is absent', async () => {
    const logger = silentLogger();
    const instance = fakeInstance({}); // no exports at all

    await createAssemblyScriptAdapter(instance, {
      missing: asc.fn(['i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not export function "missing"'),
    );
  });

  it('throws at call time when export is missing', async () => {
    const instance = fakeInstance({});

    const adapter = await createAssemblyScriptAdapter(instance, {
      missing: asc.fn(['i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    await expect(adapter.handlers.missing(1)).rejects.toThrow(
      /Export "missing" not found in WebAssembly instance/,
    );
  });
});

// ─── Dispose ──────────────────────────────────────────────────────────────────

describe('createAssemblyScriptAdapter: dispose', () => {
  it('calls __collect on dispose when runtime is available', async () => {
    const runtime = mockRuntime();
    const instance = fakeInstance({ add: (a: number, b: number) => a + b, ...runtime });

    const adapter = await createAssemblyScriptAdapter(instance, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    adapter.dispose();
    expect(runtime.__collect).toHaveBeenCalledTimes(1);
  });

  it('dispose is idempotent', async () => {
    const runtime = mockRuntime();
    const instance = fakeInstance({ ...runtime });

    const adapter = await createAssemblyScriptAdapter(instance, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    adapter.dispose();
    adapter.dispose(); // second call is safe
    expect(runtime.__collect).toHaveBeenCalledTimes(1);
  });
});

// ─── asc.fn shorthand ─────────────────────────────────────────────────────────

describe('asc.fn shorthand', () => {
  it('produces correct descriptor shape', () => {
    const d = asc.fn(['i32', 'string'] as const, 'bool' as const);
    expect(d.params).toEqual(['i32', 'string']);
    expect(d.result).toBe('bool');
  });

  it('works in a full schema definition', async () => {
    const schema = {
      compute: asc.fn(['f64', 'f64'], 'f64'),
      label:   asc.fn(['string'], 'string'),
    } satisfies AscSchema;

    expect(schema.compute.params).toEqual(['f64', 'f64']);
    expect(schema.label.result).toBe('string');
  });
});

// ─── wrapLoaderInstance ───────────────────────────────────────────────────────

describe('wrapLoaderInstance', () => {
  it('wraps loader exports into a WebAssembly.Instance shape', async () => {
    const loaderExports = {
      add: (a: number, b: number) => a + b,
    };

    const wrapped = wrapLoaderInstance(loaderExports);
    expect(wrapped.exports).toBe(loaderExports);
  });

  it('wrapped instance works with createAssemblyScriptAdapter', async () => {
    const loaderExports = {
      add: (a: number, b: number) => a + b,
    };

    const wrapped = wrapLoaderInstance(loaderExports);
    const adapter = await createAssemblyScriptAdapter(wrapped, {
      add: asc.fn(['i32', 'i32'], 'i32'),
    }, { warnOnMissingRuntime: false, logger: silentLogger() });

    const result = await adapter.handlers.add(10, 32);
    expect(result).toBe(42);
  });
});

// ─── AssemblyScriptPlugin ─────────────────────────────────────────────────────

describe('AssemblyScriptPlugin', () => {
  beforeEach(() => {
    resetMocks();
  });

  function makePlugin(name = 'math') {
    const addFn = vi.fn((a: number, b: number) => a + b);
    const instance = fakeInstance({ add: addFn });

    const plugin = new AssemblyScriptPlugin({
      name,
      source: instance as unknown as WebAssembly.Module,
      schema: { add: asc.fn(['i32', 'i32'], 'i32') },
      adapterOptions: { warnOnMissingRuntime: false, logger: silentLogger() },
    });

    return { plugin, addFn };
  }

  it('has correct name and capabilities', () => {
    const { plugin } = makePlugin('math');
    expect(plugin.name).toBe('assemblyscript:math');
    expect(plugin.capabilities).toEqual({ 'assemblyscript:math': true });
  });

  it('init loads the WASM module and calls onReady', async () => {
    const onReady = vi.fn();
    const addFn = vi.fn((a: number, b: number) => a + b);
    const instance = fakeInstance({ add: addFn });

    const plugin = new AssemblyScriptPlugin({
      name: 'math2',
      source: instance as unknown as WebAssembly.Module,
      schema: { add: asc.fn(['i32', 'i32'], 'i32') },
      adapterOptions: { warnOnMissingRuntime: false, logger: silentLogger() },
      onReady,
    });

    const ctx = { name: plugin.name, logger: silentLogger() };
    await plugin.init(ctx);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ _channels: expect.arrayContaining(['add']) }),
      expect.objectContaining({ handlers: expect.any(Object) }),
    );
  });

  it('stop disposes IPC handlers', async () => {
    // Import via the vitest alias ('electron') so we get the same ipcMain
    // instance that defineIpcApi uses internally — not a separate module copy.
    const { ipcMain } = await import('electron');
    const { plugin } = makePlugin('math3');
    const ctx = { name: plugin.name, logger: silentLogger() };

    await plugin.init(ctx);
    await plugin.stop(ctx);

    expect(ipcMain.removeHandler).toHaveBeenCalledWith('add');
  });

  it('dispose calls __collect on the WASM runtime', async () => {
    const runtime = mockRuntime();
    const instance = fakeInstance({ ...runtime, add: (a: number, b: number) => a + b });

    const plugin = new AssemblyScriptPlugin({
      name: 'math4',
      source: instance as unknown as WebAssembly.Module,
      schema: { add: asc.fn(['i32', 'i32'], 'i32') },
      adapterOptions: { warnOnMissingRuntime: false, logger: silentLogger() },
    });

    const ctx = { name: plugin.name, logger: silentLogger() };
    await plugin.init(ctx);
    await plugin.stop(ctx);
    await plugin.dispose(ctx);

    expect(runtime.__collect).toHaveBeenCalled();
  });

  it('integrates with PluginHost without conflict', () => {
    const host = new PluginHost({ logger: silentLogger() });
    const { plugin } = makePlugin('unique');
    expect(() => host.register(plugin)).not.toThrow();
  });

  it('two AssemblyScriptPlugins with the same name conflict', () => {
    const host = new PluginHost({ logger: silentLogger() });
    const { plugin: p1 } = makePlugin('shared');
    const { plugin: p2 } = makePlugin('shared');
    host.register(p1);
    expect(() => host.register(p2)).toThrow(PluginConflictError);
  });

  it('two AssemblyScriptPlugins with different names coexist', () => {
    const host = new PluginHost({ logger: silentLogger() });
    const { plugin: p1 } = makePlugin('moduleA');
    const { plugin: p2 } = makePlugin('moduleB');
    expect(() => { host.register(p1); host.register(p2); }).not.toThrow();
  });

  it('full lifecycle: init → start → stop → dispose via PluginHost', async () => {
    const onReady = vi.fn();
    const addFn = vi.fn((a: number, b: number) => a + b);
    const instance = fakeInstance({ add: addFn });
    const logger = silentLogger();

    const plugin = new AssemblyScriptPlugin({
      name: 'lifecycle',
      source: instance as unknown as WebAssembly.Module,
      schema: { add: asc.fn(['i32', 'i32'], 'i32') },
      adapterOptions: { warnOnMissingRuntime: false, logger },
      onReady,
    });

    const host = new PluginHost({ logger });
    host.register(plugin);

    await host.init();
    expect(onReady).toHaveBeenCalledTimes(1);

    await host.start();
    await host.stop();
    await host.dispose();
    // Should complete without throwing
  });
});
