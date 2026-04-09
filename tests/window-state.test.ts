/**
 * Unit tests for WindowStatePlugin.
 *
 * Uses a temporary directory for state file I/O — no filesystem mocking needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WindowStatePlugin } from '../src/plugins/window-state.js';
import type { AttachableWindow } from '../src/plugins/window-state.js';
import { PluginHost, PluginConflictError } from '../src/plugins.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'window-state-test-'));
  vi.useFakeTimers();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function silentCtx(name = 'window-state') {
  return { name, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } };
}

function makeWindow(bounds = { x: 100, y: 200, width: 800, height: 600 }): AttachableWindow & {
  listeners: Map<string, Array<() => void>>;
  trigger: (event: 'resize' | 'move' | 'close') => void;
} {
  const listeners = new Map<string, Array<() => void>>();
  return {
    listeners,
    getBounds: () => bounds,
    isMaximized: () => false,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return this;
    },
    removeListener(event, listener) {
      const list = listeners.get(event) ?? [];
      listeners.set(event, list.filter(l => l !== listener));
      return this;
    },
    trigger(event) {
      for (const l of listeners.get(event) ?? []) l();
    },
  };
}

// ─── WindowStatePlugin metadata ───────────────────────────────────────────────

describe('WindowStatePlugin: metadata', () => {
  it('has correct name and capabilities', () => {
    const p = new WindowStatePlugin({ key: 'test', stateDir: tmpDir });
    expect(p.name).toBe('window-state');
    expect(p.capabilities).toEqual({ windowState: true });
  });

  it('registers without conflict in a PluginHost', () => {
    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(() => host.register(new WindowStatePlugin({ key: 'w', stateDir: tmpDir }))).not.toThrow();
  });

  it('two WindowStatePlugins conflict (same capability key)', () => {
    const host = new PluginHost({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    host.register(new WindowStatePlugin({ key: 'w1', stateDir: tmpDir }));
    expect(() => host.register(new WindowStatePlugin({ key: 'w2', stateDir: tmpDir }))).toThrow(PluginConflictError);
  });
});

// ─── getBounds ────────────────────────────────────────────────────────────────

describe('WindowStatePlugin: getBounds', () => {
  it('returns defaultBounds when no state file exists', async () => {
    const p = new WindowStatePlugin({
      key: 'main',
      stateDir: tmpDir,
      defaultBounds: { width: 1024, height: 768 },
    });
    await p.init(silentCtx());
    expect(p.getBounds()).toMatchObject({ width: 1024, height: 768 });
  });

  it('returns saved state when state file exists', async () => {
    // First plugin saves state
    const p1 = new WindowStatePlugin({ key: 'main', stateDir: tmpDir });
    await p1.init(silentCtx());
    const win = makeWindow({ x: 50, y: 60, width: 900, height: 700 });
    p1.attach(win);
    win.trigger('close'); // forces immediate save
    await p1.dispose(silentCtx());

    // Second plugin reads saved state
    const p2 = new WindowStatePlugin({ key: 'main', stateDir: tmpDir });
    await p2.init(silentCtx());

    expect(p2.getBounds()).toMatchObject({ x: 50, y: 60, width: 900, height: 700 });
  });

  it('returns a copy — mutating result does not affect internal state', async () => {
    const p = new WindowStatePlugin({ key: 'main', stateDir: tmpDir });
    await p.init(silentCtx());
    const bounds = p.getBounds();
    bounds.width = 9999;
    expect(p.getBounds().width).not.toBe(9999);
  });
});

// ─── attach / window events ───────────────────────────────────────────────────

describe('WindowStatePlugin: attach and window events', () => {
  it('registers resize, move, close listeners on attach', async () => {
    const p = new WindowStatePlugin({ key: 'main', stateDir: tmpDir });
    await p.init(silentCtx());
    const win = makeWindow();
    p.attach(win);

    expect(win.listeners.get('resize')?.length).toBe(1);
    expect(win.listeners.get('move')?.length).toBe(1);
    expect(win.listeners.get('close')?.length).toBe(1);
  });

  it('detatches old window listeners when attaching a new window', async () => {
    const p = new WindowStatePlugin({ key: 'main', stateDir: tmpDir });
    await p.init(silentCtx());

    const win1 = makeWindow();
    const win2 = makeWindow();
    p.attach(win1);
    p.attach(win2); // replaces win1

    // win1 should have no listeners
    expect(win1.listeners.get('resize')?.length).toBe(0);
    // win2 should have listeners
    expect(win2.listeners.get('resize')?.length).toBe(1);
  });

  it('close event immediately saves state', async () => {
    const p = new WindowStatePlugin({ key: 'save-on-close', stateDir: tmpDir });
    await p.init(silentCtx());
    const win = makeWindow({ x: 10, y: 20, width: 1280, height: 960 });
    p.attach(win);

    win.trigger('close');

    const stateFile = join(tmpDir, 'window-state-save-on-close.json');
    expect(existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(saved.width).toBe(1280);
  });

  it('resize event schedules a debounced save', async () => {
    const p = new WindowStatePlugin({ key: 'debounce', stateDir: tmpDir, saveDebounceMs: 100 });
    await p.init(silentCtx());
    const win = makeWindow({ x: 0, y: 0, width: 400, height: 300 });
    p.attach(win);

    win.trigger('resize');
    // File should not be written yet (within debounce window)
    expect(existsSync(join(tmpDir, 'window-state-debounce.json'))).toBe(false);

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(150);
    expect(existsSync(join(tmpDir, 'window-state-debounce.json'))).toBe(true);
  });

  it('multiple resize events within debounce window result in a single save', async () => {
    const p = new WindowStatePlugin({ key: 'multi-resize', stateDir: tmpDir, saveDebounceMs: 100 });
    await p.init(silentCtx());
    const win = makeWindow();
    p.attach(win);

    win.trigger('resize');
    win.trigger('resize');
    win.trigger('resize');

    // Only one timer should be active — advance past debounce
    await vi.advanceTimersByTimeAsync(150);

    const stateFile = join(tmpDir, 'window-state-multi-resize.json');
    expect(existsSync(stateFile)).toBe(true);
  });
});

// ─── stop / dispose ───────────────────────────────────────────────────────────

describe('WindowStatePlugin: stop and dispose', () => {
  it('stop flushes pending state to disk', async () => {
    const p = new WindowStatePlugin({ key: 'stop-flush', stateDir: tmpDir, saveDebounceMs: 500 });
    await p.init(silentCtx());
    const win = makeWindow({ x: 5, y: 5, width: 600, height: 400 });
    p.attach(win);

    win.trigger('resize'); // starts debounce timer
    // stop() should flush without waiting for debounce
    await p.stop(silentCtx());

    const stateFile = join(tmpDir, 'window-state-stop-flush.json');
    expect(existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(saved.width).toBe(600);
  });

  it('dispose detaches window listeners', async () => {
    const p = new WindowStatePlugin({ key: 'dispose-detach', stateDir: tmpDir });
    await p.init(silentCtx());
    const win = makeWindow();
    p.attach(win);
    await p.stop(silentCtx());
    await p.dispose(silentCtx());

    // Listeners should be removed
    expect(win.listeners.get('resize')?.length).toBe(0);
    expect(win.listeners.get('move')?.length).toBe(0);
    expect(win.listeners.get('close')?.length).toBe(0);
  });

  it('stop is a no-op when no window is attached', async () => {
    const p = new WindowStatePlugin({ key: 'no-win', stateDir: tmpDir });
    await p.init(silentCtx());
    await expect(p.stop(silentCtx())).resolves.toBeUndefined();
  });

  it('stop calls saveNow when a window is attached', async () => {
    const p = new WindowStatePlugin({ key: 'stop-save', stateDir: tmpDir, saveDebounceMs: 500 });
    await p.init(silentCtx());
    const win = makeWindow({ x: 1, y: 2, width: 640, height: 480 });
    p.attach(win);
    win.trigger('resize');
    await p.stop(silentCtx());

    expect(existsSync(join(tmpDir, 'window-state-stop-save.json'))).toBe(true);
  });
});

// ─── state file format ────────────────────────────────────────────────────────

describe('WindowStatePlugin: state file format', () => {
  it('state file is valid JSON with expected keys', async () => {
    const p = new WindowStatePlugin({ key: 'format', stateDir: tmpDir });
    await p.init(silentCtx());
    const win = makeWindow({ x: 10, y: 20, width: 800, height: 600 });
    p.attach(win);
    win.trigger('close');

    const raw = readFileSync(join(tmpDir, 'window-state-format.json'), 'utf-8');
    const parsed = JSON.parse(raw);

    expect(typeof parsed.x).toBe('number');
    expect(typeof parsed.y).toBe('number');
    expect(typeof parsed.width).toBe('number');
    expect(typeof parsed.height).toBe('number');
    expect(typeof parsed.isMaximized).toBe('boolean');
  });

  it('handles corrupt state file gracefully (falls back to defaults)', async () => {
    writeFileSync(join(tmpDir, 'window-state-corrupt.json'), 'not-json!!', 'utf-8');

    const p = new WindowStatePlugin({
      key: 'corrupt',
      stateDir: tmpDir,
      defaultBounds: { width: 1200, height: 800 },
    });
    await p.init(silentCtx());

    expect(p.getBounds()).toMatchObject({ width: 1200, height: 800 });
  });

  it('handles state file with missing width/height (falls back to defaults)', async () => {
    writeFileSync(join(tmpDir, 'window-state-partial.json'), JSON.stringify({ x: 0, y: 0 }), 'utf-8');

    const p = new WindowStatePlugin({
      key: 'partial',
      stateDir: tmpDir,
      defaultBounds: { width: 1024, height: 768 },
    });
    await p.init(silentCtx());

    expect(p.getBounds()).toMatchObject({ width: 1024, height: 768 });
  });

  it('logs an error when saving fails while persisting state', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const invalidStateDir = join(tmpDir, 'not-a-directory.txt');
    writeFileSync(invalidStateDir, 'blocking dir creation', 'utf-8');

    const p = new WindowStatePlugin({ key: 'persist-error', stateDir: invalidStateDir });
    await p.init({ name: 'window-state', logger });
    const win = makeWindow();
    p.attach(win);
    win.trigger('close');

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to persist window state:',
      expect.anything(),
    );
  });

  it('logs an error when reading window bounds fails', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const p = new WindowStatePlugin({ key: 'save-error', stateDir: tmpDir });
    await p.init({ name: 'window-state', logger });
    const win = makeWindow();
    const failingWin = {
      ...win,
      getBounds: () => {
      throw new Error('bounds-failed');
      },
    };
    p.attach(failingWin);
    win.trigger('close');

    expect(logger.error).toHaveBeenCalledWith('Failed to save window state:', expect.any(Error));
  });
});
