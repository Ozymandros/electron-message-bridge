/**
 * Shim compatibility test for `electron-ipc-helper/adapters/assemblyscript`.
 *
 * The AssemblyScript adapter implementation has moved to the standalone
 * package `@electron-ipc-helper/adapter-assemblyscript`. The core package
 * retains a thin deprecated re-export shim for one transition release.
 *
 * These tests verify that:
 * 1. All public symbols are still accessible through the old import path.
 * 2. The `asc.fn` shorthand works correctly through the shim.
 * 3. `wrapLoaderInstance` is accessible through the shim.
 *
 * Full unit tests (codec, managed types, plugin lifecycle, etc.) live in:
 *   packages/adapter-assemblyscript/tests/index.test.ts
 */

import { describe, expect, it } from 'vitest';

// Import via the OLD (deprecated) path — this is what the shim test is about
import {
  createAssemblyScriptAdapter,
  wrapLoaderInstance,
  AssemblyScriptPlugin,
  asc,
} from '../../src/adapters/assemblyscript.js';
import type { AscSchema } from '../../src/adapters/assemblyscript.js';

// ─── Shim exports surface ─────────────────────────────────────────────────────

describe('shim: electron-ipc-helper/adapters/assemblyscript re-exports', () => {
  it('createAssemblyScriptAdapter is a function', () => {
    expect(typeof createAssemblyScriptAdapter).toBe('function');
  });

  it('wrapLoaderInstance is a function', () => {
    expect(typeof wrapLoaderInstance).toBe('function');
  });

  it('AssemblyScriptPlugin is a class', () => {
    expect(typeof AssemblyScriptPlugin).toBe('function');
  });

  it('asc is an object with fn helper', () => {
    expect(typeof asc).toBe('object');
    expect(typeof asc.fn).toBe('function');
  });

  it('asc.fn produces a valid descriptor', () => {
    const desc = asc.fn(['i32', 'f64'] as const, 'string' as const);
    expect(desc.params).toEqual(['i32', 'f64']);
    expect(desc.result).toBe('string');
  });

  it('wrapLoaderInstance returns an object with exports', () => {
    const exports = { add: (a: number, b: number) => a + b };
    const wrapped = wrapLoaderInstance(exports);
    expect(wrapped.exports).toBe(exports);
  });
});

// ─── Shim functional smoke test ───────────────────────────────────────────────

describe('shim: functional smoke test through old import path', () => {
  function silentLogger() {
    return { log: () => {}, warn: () => {}, error: () => {} };
  }

  it('createAssemblyScriptAdapter works with a fake instance', async () => {
    const addFn = (a: number, b: number) => a + b;
    // Use duck-type cast to avoid referencing WebAssembly.Instance as a type
    const fakeSource = { exports: { add: addFn } } as Parameters<typeof createAssemblyScriptAdapter>[0];

    const schema = { add: asc.fn(['i32', 'i32'], 'i32') };
    const adapter = await createAssemblyScriptAdapter(fakeSource, schema, {
      warnOnMissingRuntime: false,
      logger: silentLogger(),
    });

    const result = await adapter.handlers.add(10, 32);
    expect(result).toBe(42);
    adapter.dispose();
  });

  it('AssemblyScriptPlugin has correct capability shape', () => {
    const fakeSource = { exports: { add: (a: number, b: number) => a + b } } as unknown as WebAssembly.Module;
    const plugin = new AssemblyScriptPlugin({
      name: 'shim-smoke',
      source: fakeSource,
      schema: { add: asc.fn(['i32', 'i32'], 'i32') },
      adapterOptions: { warnOnMissingRuntime: false, logger: silentLogger() },
    });

    expect(plugin.name).toBe('assemblyscript:shim-smoke');
    expect(plugin.capabilities).toEqual({ 'assemblyscript:shim-smoke': true });
  });
});

// ─── Type-level check (runtime) ───────────────────────────────────────────────

describe('shim: type exports are usable at runtime', () => {
  it('AscSchema-shaped object can be typed and used', () => {
    // Verifies type-level compatibility by using the inferred types at runtime
    const schema = {
      compute: asc.fn(['f64'], 'f64'),
    } satisfies AscSchema;

    expect(schema.compute.params).toEqual(['f64']);
    expect(schema.compute.result).toBe('f64');
  });
});
