/**
 * WASM codec performance benchmarks.
 *
 * Measures the encoding/decoding overhead for each type that crosses the
 * JavaScript ↔ AssemblyScript boundary. All benchmarks use the same mock
 * runtime and fake `WebAssembly.Instance` used in the unit tests — no real
 * `.wasm` file is needed.
 *
 * ## What is measured
 *
 * - **Primitive encoding**: i32, u32, i64, f32, f64, bool — these are direct
 *   JS → number/bigint casts, so they should be near-zero overhead.
 * - **Managed type encoding**: string, bytes — these require runtime allocations
 *   (`__newString`, `__newArrayBuffer`, `__pin`) and are the most expensive.
 * - **Decoding**: the reverse of the above; `__getString`, `__getArrayBuffer`.
 * - **Multi-argument call**: measures the full per-call budget for a realistic
 *   function with mixed primitive and managed args.
 * - **Pinning lifecycle**: measures the pin/unpin GC overhead alone.
 * - **ExportMissingError fast path**: benchmark the cost of a missing-export
 *   handler call (should be a near-instant async rejection).
 *
 * ## Budget targets
 *
 *  Operation                             | p99 budget
 * ---------------------------------------|------------
 *  Primitive encode (i32/f64)            | < 0.2 µs
 *  String encode (mock __newString)      | < 5 µs
 *  Bytes encode (mock __newArrayBuffer)  | < 5 µs
 *  Full call cycle (2× primitive args)   | < 2 µs
 *  Full call cycle (string → string)     | < 10 µs
 *  Missing-export async rejection        | < 10 µs
 *
 * Run with: vitest bench
 */

import { bench, describe, vi, beforeAll } from 'vitest';

// ─── Shared mock setup ────────────────────────────────────────────────────────

// We lazily import createAssemblyScriptAdapter so the electron mock is in place
// before the module resolves. This mirrors the unit-test approach.

let createAssemblyScriptAdapter: Awaited<
  ReturnType<typeof import('../packages/adapter-assemblyscript/src/index.js')>
>['createAssemblyScriptAdapter'];

let asc: Awaited<
  ReturnType<typeof import('../packages/adapter-assemblyscript/src/index.js')>
>['asc'];

const ipcMainMock = { handle: vi.fn(), removeHandler: vi.fn() };
vi.mock('electron', () => ({ ipcMain: ipcMainMock }));

beforeAll(async () => {
  const mod = await import('../packages/adapter-assemblyscript/src/index.js');
  createAssemblyScriptAdapter = mod.createAssemblyScriptAdapter;
  asc = mod.asc;
});

// ─── Shared mock factory ──────────────────────────────────────────────────────

/** Build a fake `WebAssembly.Instance`-shaped object with given exports. */
function fakeInstance(exports: Record<string, unknown>): { exports: typeof exports } {
  return { exports };
}

/** Build a minimal mock AssemblyScript runtime with spy-able exports. */
function mockRuntime() {
  // Simulate a pointer allocator: returns incrementing integer addresses
  let ptr = 1000;
  const alloc = () => ptr++;

  const memory = new WebAssembly.Memory({ initial: 1 });

  return {
    memory,
    __new: vi.fn(alloc),
    __pin: vi.fn((p: number) => p),
    __unpin: vi.fn(),
    __collect: vi.fn(),
    __getString: vi.fn((_ptr: number) => 'decoded-string'),
    __newString: vi.fn(alloc),
    __getArrayBuffer: vi.fn((_ptr: number) => new ArrayBuffer(4)),
    __newArrayBuffer: vi.fn(alloc),
  };
}

function silentLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// ─── Primitive encode/decode ──────────────────────────────────────────────────

describe('primitive type call cycle', () => {
  bench('i32 + i32 → i32 (two-primitive add function)', async () => {
    const instance = fakeInstance({ add: (a: number, b: number) => a + b });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { add: asc.fn(['i32', 'i32'], 'i32') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.add(3, 4);
  });

  bench('f64 → f64 (square root)', async () => {
    const instance = fakeInstance({ sqrt: (x: number) => Math.sqrt(x) });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { sqrt: asc.fn(['f64'], 'f64') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.sqrt(144);
  });

  bench('bool → i32 (identity cast)', async () => {
    const instance = fakeInstance({ boolToInt: (b: number) => b });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { boolToInt: asc.fn(['bool'], 'i32') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.boolToInt(true);
  });

  bench('i64 → i64 (bigint passthrough)', async () => {
    const instance = fakeInstance({ identity: (n: bigint) => n });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { identity: asc.fn(['i64'], 'i64') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.identity(BigInt(12345));
  });
});

// ─── Managed type encode/decode ───────────────────────────────────────────────

describe('managed type call cycle (requires mock runtime)', () => {
  bench('string → string (greet function)', async () => {
    const rt = mockRuntime();
    const instance = fakeInstance({
      greet: (_ptr: number) => rt.__newString(),
      ...rt,
    });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { greet: asc.fn(['string'], 'string') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.greet('World');
  });

  bench('bytes → bytes (round-trip through mock runtime)', async () => {
    const rt = mockRuntime();
    const instance = fakeInstance({
      processBytes: (_ptr: number) => rt.__newArrayBuffer(),
      ...rt,
    });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { processBytes: asc.fn(['bytes'], 'bytes') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.processBytes(new Uint8Array([1, 2, 3, 4]));
  });

  bench('mixed args: i32 + string → i32 (encode only manages string)', async () => {
    const rt = mockRuntime();
    const instance = fakeInstance({
      mixed: (_n: number, _ptr: number) => 42,
      ...rt,
    });
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { mixed: asc.fn(['i32', 'string'], 'i32') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    await adapter.handlers.mixed(5, 'hello');
  });
});

// ─── Adapter construction cost ────────────────────────────────────────────────

describe('adapter construction cost', () => {
  bench('createAssemblyScriptAdapter — 1 primitive export', async () => {
    const instance = fakeInstance({ add: (a: number, b: number) => a + b });
    await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { add: asc.fn(['i32', 'i32'], 'i32') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
  });

  bench('createAssemblyScriptAdapter — 10 primitive exports', async () => {
    const exports = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`fn${i}`, (x: number) => x + i]),
    );
    const schema = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`fn${i}`, asc.fn(['i32'], 'i32')]),
    );
    const instance = fakeInstance(exports);
    await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      schema,
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
  });
});

// ─── ExportMissingError fast path ─────────────────────────────────────────────

describe('ExportMissingError rejection path', () => {
  bench('call to missing export — async rejection cost', async () => {
    const instance = fakeInstance({}); // no exports
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      { missing: asc.fn(['i32'], 'i32') },
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    try {
      await adapter.handlers.missing(1);
    } catch {
      // expected — ExportMissingError
    }
  });
});

// ─── Dispose overhead ─────────────────────────────────────────────────────────

describe('adapter dispose overhead', () => {
  bench('dispose() for 5-handler adapter', async () => {
    const exports = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`fn${i}`, (x: number) => x]),
    );
    const schema = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`fn${i}`, asc.fn(['i32'], 'i32')]),
    );
    const instance = fakeInstance(exports);
    const adapter = await createAssemblyScriptAdapter(
      instance as unknown as WebAssembly.Instance,
      schema,
      { warnOnMissingRuntime: false, logger: silentLogger() },
    );
    adapter.dispose();
    ipcMainMock.removeHandler.mockReset();
  });
});
