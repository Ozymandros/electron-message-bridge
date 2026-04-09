/**
 * API surface snapshot tests.
 *
 * These tests guard against accidental breaking changes to the public API
 * surface of every entry point. They intentionally import the source modules
 * (not the built dist) and assert:
 *
 *  1. Every expected export symbol is present.
 *  2. Each symbol has the expected typeof.
 *  3. No unexpected symbols have been silently added to a Stable surface.
 *
 * When you intentionally add a new export, update the snapshot below.
 * If a test fails unexpectedly, you have made an accidental breaking change.
 */

import { describe, it, expect } from 'vitest';
import * as mainIndex from '../src/index.js';
import * as preload from '../src/preload.js';
import * as integrations from '../src/integrations.js';
import * as menus from '../src/menus.js';
import * as lifecycle from '../src/lifecycle.js';
import * as boundary from '../src/boundary.js';
import * as adapterLoader from '../src/adapters/loader.js';
// The shim re-exports from @electron-ipc-helper/adapter-assemblyscript;
// we import the shim here to verify the re-export surface is intact.
import * as ascAdapter from '../src/adapters/assemblyscript.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Returns the sorted list of exported *value* (non-type) symbol names.
 * TypeScript type-only exports are erased at runtime and do not appear here.
 */
function valueExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).sort();
}

// ─── src/index (main process entry) ──────────────────────────────────────────

describe('src/index — main process entry point', () => {
  it('exports exactly the expected symbols', () => {
    const exported = valueExports(mainIndex);
    expect(exported).toEqual([
      'AdapterMissingError',
      'BridgeTimeoutError',
      'ChildProcessLifecycle',
      'ERR_ADAPTER_MISSING',
      'ERR_BRIDGE_TIMEOUT',
      'ERR_EXPORT_MISSING',
      'ERR_INVALID_BRIDGE_PAYLOAD',
      'ERR_INVALID_PAYLOAD',
      'ERR_MAX_RESTARTS',
      'ERR_PLUGIN_CONFLICT',
      'ERR_RUNTIME_MISSING',
      'ERR_TRANSPORT_FAILURE',
      'ExportMissingError',
      'InvalidBridgePayloadError',
      'InvalidPayloadError',
      'IpcHelperError',
      'MaxRestartsError',
      'PROTOCOL_VERSION',
      'PluginConflictError',
      'RuntimeMissingError',
      'TransportError',
      'assertBridgePayload',
      'defineIpcApi',
      'defineIpcEvents',
      'isBridgePayload',
      'isNegotiablePlugin',
      'negotiate',
      'withBoundary',
      'withOutputValidation',
      'withValidation',
    ]);
  });

  it('defineIpcApi is a function', () => {
    expect(typeof mainIndex.defineIpcApi).toBe('function');
  });

  it('defineIpcEvents is a function', () => {
    expect(typeof mainIndex.defineIpcEvents).toBe('function');
  });

  it('ChildProcessLifecycle is a class (function)', () => {
    expect(typeof mainIndex.ChildProcessLifecycle).toBe('function');
  });
});

// ─── src/preload ──────────────────────────────────────────────────────────────

describe('src/preload — preload script entry point', () => {
  it('exports exactly the expected symbols', () => {
    const exported = valueExports(preload);
    expect(exported).toEqual([
      'exposeApiToRenderer',
      'exposeDialogsToRenderer',
      'exposeEventsToRenderer',
      'exposeShellToRenderer',
      'exposeValues',
    ]);
  });

  it('all preload exports are functions', () => {
    const fnExports = [
      'exposeApiToRenderer',
      'exposeEventsToRenderer',
      'exposeValues',
      'exposeDialogsToRenderer',
      'exposeShellToRenderer',
    ] as const;

    for (const name of fnExports) {
      expect(typeof (preload as Record<string, unknown>)[name], `${name} should be function`).toBe('function');
    }
  });
});

// ─── src/integrations ────────────────────────────────────────────────────────

describe('src/integrations — built-in IPC helper registrars', () => {
  it('exports registerDialogHandlers and registerShellHandlers', () => {
    expect(typeof integrations.registerDialogHandlers).toBe('function');
    expect(typeof integrations.registerShellHandlers).toBe('function');
  });

  it('exports exposeDialogsToRenderer and exposeShellToRenderer', () => {
    expect(typeof integrations.exposeDialogsToRenderer).toBe('function');
    expect(typeof integrations.exposeShellToRenderer).toBe('function');
  });
});

// ─── src/menus ────────────────────────────────────────────────────────────────

describe('src/menus — declarative menu helpers', () => {
  it('exports buildMenuTemplate, loadMenuSpecFromFile, applyApplicationMenuFromFile', () => {
    expect(typeof menus.buildMenuTemplate).toBe('function');
    expect(typeof menus.loadMenuSpecFromFile).toBe('function');
    expect(typeof menus.applyApplicationMenuFromFile).toBe('function');
  });

  it('exports action descriptor factory helpers', () => {
    expect(typeof menus.commandAction).toBe('function');
    expect(typeof menus.serviceAction).toBe('function');
    expect(typeof menus.emitAction).toBe('function');
  });

  it('factory helpers produce correct kind values', () => {
    const cmd = menus.commandAction(() => {});
    const svc = menus.serviceAction(async () => {});
    const emit = menus.emitAction(() => {});

    expect(cmd.kind).toBe('command');
    expect(svc.kind).toBe('service');
    expect(emit.kind).toBe('emit');
  });
});

// ─── src/adapters/assemblyscript ──────────────────────────────────────────────

describe('src/adapters/assemblyscript — optional AssemblyScript WASM adapter', () => {
  it('exports createAssemblyScriptAdapter as a function', () => {
    expect(typeof ascAdapter.createAssemblyScriptAdapter).toBe('function');
  });

  it('exports wrapLoaderInstance as a function', () => {
    expect(typeof ascAdapter.wrapLoaderInstance).toBe('function');
  });

  it('exports AssemblyScriptPlugin as a class (function)', () => {
    expect(typeof ascAdapter.AssemblyScriptPlugin).toBe('function');
  });

  it('exports asc shorthand object with fn helper', () => {
    expect(typeof ascAdapter.asc).toBe('object');
    expect(typeof ascAdapter.asc.fn).toBe('function');
  });

  it('asc.fn produces a valid descriptor', () => {
    const desc = ascAdapter.asc.fn(['i32', 'f64'] as const, 'string' as const);
    expect(desc.params).toEqual(['i32', 'f64']);
    expect(desc.result).toBe('string');
  });
});

// ─── src/index — error taxonomy exports ──────────────────────────────────────

describe('src/index — error taxonomy exports', () => {
  const ERROR_CLASSES = [
    'IpcHelperError',
    'InvalidPayloadError',
    'InvalidBridgePayloadError',
    'BridgeTimeoutError',
    'MaxRestartsError',
    'PluginConflictError',
    'ExportMissingError',
    'RuntimeMissingError',
    'AdapterMissingError',
    'TransportError',
  ] as const;

  const ERROR_CODES = [
    'ERR_INVALID_PAYLOAD',
    'ERR_INVALID_BRIDGE_PAYLOAD',
    'ERR_BRIDGE_TIMEOUT',
    'ERR_MAX_RESTARTS',
    'ERR_PLUGIN_CONFLICT',
    'ERR_EXPORT_MISSING',
    'ERR_RUNTIME_MISSING',
    'ERR_ADAPTER_MISSING',
    'ERR_TRANSPORT_FAILURE',
  ] as const;

  it('exports all error classes as functions', () => {
    for (const name of ERROR_CLASSES) {
      expect(typeof (mainIndex as Record<string, unknown>)[name], `${name} should be a function`).toBe('function');
    }
  });

  it('exports all error code constants as strings', () => {
    for (const code of ERROR_CODES) {
      expect(typeof (mainIndex as Record<string, unknown>)[code], `${code} should be a string`).toBe('string');
      expect((mainIndex as Record<string, unknown>)[code]).toBe(code);
    }
  });

  it('error code constants match their literal values', () => {
    expect(mainIndex.ERR_INVALID_PAYLOAD).toBe('ERR_INVALID_PAYLOAD');
    expect(mainIndex.ERR_BRIDGE_TIMEOUT).toBe('ERR_BRIDGE_TIMEOUT');
    expect(mainIndex.ERR_EXPORT_MISSING).toBe('ERR_EXPORT_MISSING');
  });
});

// ─── src/lifecycle ────────────────────────────────────────────────────────────

describe('src/lifecycle — child process lifecycle helpers', () => {
  it('exports ChildProcessLifecycle class', () => {
    expect(typeof lifecycle.ChildProcessLifecycle).toBe('function');
  });

  it('ChildProcessLifecycle instances have expected public methods', () => {
    // We only verify the interface surface, not spawn behavior
    const instance = new lifecycle.ChildProcessLifecycle({ command: 'node' });
    expect(typeof instance.start).toBe('function');
    expect(typeof instance.stop).toBe('function');
    expect(typeof instance.on).toBe('function');
    expect(typeof instance.isReady).toBe('function');
  });

  it('ChildProcessLifecycle.pid is undefined before start', () => {
    const instance = new lifecycle.ChildProcessLifecycle({ command: 'node' });
    expect(instance.pid).toBeUndefined();
  });
});

// ─── src/boundary ─────────────────────────────────────────────────────────────

describe('src/boundary — bridge payload contracts', () => {
  const BOUNDARY_FNS = [
    'assertBridgePayload',
    'isBridgePayload',
    'withBoundary',
    'withOutputValidation',
    'withValidation',
  ] as const;

  it('exports exactly the expected symbols', () => {
    expect(valueExports(boundary)).toEqual(BOUNDARY_FNS);
  });

  it('all boundary exports are functions', () => {
    for (const name of BOUNDARY_FNS) {
      expect(typeof (boundary as Record<string, unknown>)[name], `${name} should be a function`).toBe('function');
    }
  });

  it('isBridgePayload is a function exported from main index too', () => {
    expect(typeof mainIndex.isBridgePayload).toBe('function');
    expect(typeof mainIndex.withValidation).toBe('function');
    expect(typeof mainIndex.withBoundary).toBe('function');
  });

  it('isBridgePayload returns true for JSON-safe values', () => {
    expect(boundary.isBridgePayload(null)).toBe(true);
    expect(boundary.isBridgePayload(true)).toBe(true);
    expect(boundary.isBridgePayload(42)).toBe(true);
    expect(boundary.isBridgePayload('hello')).toBe(true);
    expect(boundary.isBridgePayload([1, 'two', null])).toBe(true);
    expect(boundary.isBridgePayload({ a: 1, b: { c: 'nested' } })).toBe(true);
  });

  it('isBridgePayload returns false for non-serialisable values', () => {
    expect(boundary.isBridgePayload(undefined)).toBe(false);
    expect(boundary.isBridgePayload(NaN)).toBe(false);
    expect(boundary.isBridgePayload(Infinity)).toBe(false);
    expect(boundary.isBridgePayload(new Date())).toBe(false);
    expect(boundary.isBridgePayload(() => {})).toBe(false);
    expect(boundary.isBridgePayload(BigInt(1))).toBe(false);
  });
});

// ─── src/adapters/loader ──────────────────────────────────────────────────────

describe('src/adapters/loader — dynamic adapter loading', () => {
  it('exports requireAdapter as a function', () => {
    expect(typeof adapterLoader.requireAdapter).toBe('function');
  });

  it('requireAdapter resolves a promise on success', async () => {
    const result = await adapterLoader.requireAdapter('test', () => Promise.resolve({ hello: 'world' }));
    expect(result).toEqual({ hello: 'world' });
  });

  it('requireAdapter converts MODULE_NOT_FOUND into AdapterMissingError', async () => {
    const { AdapterMissingError } = await import('../src/errors.js');
    const notFound = Object.assign(new Error("Cannot find module 'my-missing-pkg'"), { code: 'MODULE_NOT_FOUND' });

    await expect(
      adapterLoader.requireAdapter('my-missing-pkg', () => Promise.reject(notFound)),
    ).rejects.toBeInstanceOf(AdapterMissingError);
  });

  it('requireAdapter re-throws non-module-not-found errors unchanged', async () => {
    const runtimeError = new Error('Runtime crash inside adapter');

    await expect(
      adapterLoader.requireAdapter('my-pkg', () => Promise.reject(runtimeError)),
    ).rejects.toBe(runtimeError);
  });
});

// ─── src/adapters/assemblyscript shim ────────────────────────────────────────

describe('src/adapters/assemblyscript shim — loadAssemblyScriptAdapter lazy loader', () => {
  it('exports loadAssemblyScriptAdapter as a function', () => {
    expect(typeof ascAdapter.loadAssemblyScriptAdapter).toBe('function');
  });

  it('loadAssemblyScriptAdapter returns a Promise', () => {
    // We don't await it (would need the real package) — just check shape
    const result = ascAdapter.loadAssemblyScriptAdapter();
    expect(result).toBeInstanceOf(Promise);
    // Clean up unhandled rejection — the package IS installed in tests via aliases
    result.catch(() => {});
  });
});
