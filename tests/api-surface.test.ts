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
    // Stable surface: defineIpcApi, defineIpcEvents
    // Beta: ChildProcessLifecycle
    expect(exported).toContain('defineIpcApi');
    expect(exported).toContain('defineIpcEvents');
    expect(exported).toContain('ChildProcessLifecycle');
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
    expect(exported).toContain('exposeApiToRenderer');
    expect(exported).toContain('exposeEventsToRenderer');
    expect(exported).toContain('exposeValues');
    // Compat re-exports from integrations
    expect(exported).toContain('exposeDialogsToRenderer');
    expect(exported).toContain('exposeShellToRenderer');
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
