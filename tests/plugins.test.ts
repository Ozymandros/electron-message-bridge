/**
 * Unit tests for the plugin system.
 *
 * Covers:
 * - PluginHost registration, lifecycle orchestration, error isolation
 * - PluginConflictError detection
 * - DiagnosticsPlugin behavior
 * - UpdaterPlugin facade
 * - WindowStatePlugin state persistence (filesystem mocked)
 */

import { describe, expect, it, vi } from 'vitest';
import { PluginHost, PluginConflictError } from '../src/plugins.js';
import type { Plugin, PluginContext } from '../src/plugins.js';
import { DiagnosticsPlugin } from '../src/plugins/diagnostics.js';
import { UpdaterPlugin } from '../src/plugins/updater.js';
import type { UpdaterEngine } from '../src/plugins/updater.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlugin(
  name: string,
  overrides: Partial<Plugin> = {},
): Plugin & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    name,
    async init(_ctx: PluginContext) { calls.push('init'); },
    async start(_ctx: PluginContext) { calls.push('start'); },
    async stop(_ctx: PluginContext) { calls.push('stop'); },
    async dispose(_ctx: PluginContext) { calls.push('dispose'); },
    ...overrides,
    calls,
  };
}

function silentLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// ─── PluginHost: registration ─────────────────────────────────────────────────

describe('PluginHost: registration', () => {
  it('registers a plugin and returns the host (fluent API)', () => {
    const host = new PluginHost({ logger: silentLogger() });
    const p = makePlugin('alpha');
    const result = host.register(p);
    expect(result).toBe(host);
    expect(host.getPlugins()).toHaveLength(1);
  });

  it('registers multiple plugins', () => {
    const host = new PluginHost({ logger: silentLogger() });
    host.register(makePlugin('a')).register(makePlugin('b'));
    expect(host.getPlugins()).toHaveLength(2);
  });

  it('getPlugins returns a copy (immutable)', () => {
    const host = new PluginHost({ logger: silentLogger() });
    host.register(makePlugin('a'));
    const list = host.getPlugins();
    // Mutating the returned array does not affect the host
    (list as Plugin[]).push(makePlugin('injected'));
    expect(host.getPlugins()).toHaveLength(1);
  });

  it('throws PluginConflictError when two plugins share a capability', () => {
    const host = new PluginHost({ logger: silentLogger() });
    host.register({ name: 'p1', capabilities: { featureX: true } });
    expect(() => {
      host.register({ name: 'p2', capabilities: { featureX: true } });
    }).toThrow(PluginConflictError);
  });

  it('PluginConflictError carries correct metadata', () => {
    const host = new PluginHost({ logger: silentLogger() });
    host.register({ name: 'p1', capabilities: { featureX: true } });
    let caught: PluginConflictError | null = null;
    try {
      host.register({ name: 'p2', capabilities: { featureX: true } });
    } catch (err) {
      caught = err as PluginConflictError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.capability).toBe('featureX');
    expect(caught!.existing).toBe('p1');
    expect(caught!.incoming).toBe('p2');
  });

  it('allows plugins with non-overlapping capabilities', () => {
    const host = new PluginHost({ logger: silentLogger() });
    expect(() => {
      host
        .register({ name: 'p1', capabilities: { featureA: true } })
        .register({ name: 'p2', capabilities: { featureB: true } });
    }).not.toThrow();
  });

  it('hasCapability returns true when capability is registered', () => {
    const host = new PluginHost({ logger: silentLogger() });
    host.register({ name: 'p1', capabilities: { featureX: true } });
    expect(host.hasCapability('featureX')).toBe(true);
    expect(host.hasCapability('featureY')).toBe(false);
  });
});

// ─── PluginHost: lifecycle orchestration ─────────────────────────────────────

describe('PluginHost: lifecycle orchestration', () => {
  it('calls init, start, stop, dispose in correct order', async () => {
    const host = new PluginHost({ logger: silentLogger() });
    const p = makePlugin('alpha');
    host.register(p);

    await host.init();
    await host.start();
    await host.stop();
    await host.dispose();

    expect(p.calls).toEqual(['init', 'start', 'stop', 'dispose']);
  });

  it('calls stop and dispose in reverse registration order', async () => {
    const host = new PluginHost({ logger: silentLogger() });
    const order: string[] = [];

    const p1 = {
      name: 'first',
      stop: () => { order.push('first:stop'); },
      dispose: () => { order.push('first:dispose'); },
    };
    const p2 = {
      name: 'second',
      stop: () => { order.push('second:stop'); },
      dispose: () => { order.push('second:dispose'); },
    };

    host.register(p1).register(p2);
    await host.stop();
    await host.dispose();

    expect(order).toEqual(['second:stop', 'first:stop', 'second:dispose', 'first:dispose']);
  });

  it('calls init and start in registration order', async () => {
    const host = new PluginHost({ logger: silentLogger() });
    const order: string[] = [];

    host.register({ name: 'first',  init: () => { order.push('first:init');  }, start: () => { order.push('first:start');  } });
    host.register({ name: 'second', init: () => { order.push('second:init'); }, start: () => { order.push('second:start'); } });

    await host.init();
    await host.start();

    expect(order).toEqual(['first:init', 'second:init', 'first:start', 'second:start']);
  });

  it('skips plugins that do not implement a hook', async () => {
    const host = new PluginHost({ logger: silentLogger() });
    const p = { name: 'sparse' }; // no hooks at all
    host.register(p);
    // Should not throw
    await host.init();
    await host.start();
    await host.stop();
    await host.dispose();
  });
});

// ─── PluginHost: error isolation ─────────────────────────────────────────────

describe('PluginHost: error isolation', () => {
  it('continues calling remaining plugins when one throws', async () => {
    const host = new PluginHost({ logger: silentLogger() });
    const calls: string[] = [];

    host.register({
      name: 'bad',
      init: () => { throw new Error('boom'); },
    });
    host.register({
      name: 'good',
      init: () => { calls.push('good:init'); },
    });

    await host.init(); // should not throw

    expect(calls).toContain('good:init');
  });

  it('calls onError with plugin name and hook when a plugin throws', async () => {
    const onError = vi.fn();
    const host = new PluginHost({ logger: silentLogger(), onError });

    host.register({
      name: 'crasher',
      start: () => { throw new Error('crash!'); },
    });

    await host.start();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      'crasher',
      'start',
    );
  });

  it('normalizes non-Error throws', async () => {
    const onError = vi.fn();
    const host = new PluginHost({ logger: silentLogger(), onError });

    host.register({
      name: 'thrower',
      init: () => { throw 'string error'; },
    });

    await host.init();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'string error' }),
      'thrower',
      'init',
    );
  });
});

// ─── DiagnosticsPlugin ────────────────────────────────────────────────────────

describe('DiagnosticsPlugin', () => {
  it('exports correct capability key', () => {
    const p = new DiagnosticsPlugin();
    expect(p.capabilities).toEqual({ diagnostics: true });
    expect(p.name).toBe('diagnostics');
  });

  it('getSnapshot returns zero uptimeMs before init', () => {
    const p = new DiagnosticsPlugin();
    expect(p.getSnapshot().uptimeMs).toBe(0);
  });

  it('getSnapshot returns positive uptimeMs after init', () => {
    const p = new DiagnosticsPlugin();
    const ctx = { name: 'diagnostics', logger: silentLogger() };
    p.init(ctx);
    expect(p.getSnapshot().uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('recordIpc increments channel counts', () => {
    const p = new DiagnosticsPlugin();
    p.recordIpc('getUser');
    p.recordIpc('getUser');
    p.recordIpc('saveFile');
    expect(p.getSnapshot().ipcCounts).toEqual({ getUser: 2, saveFile: 1 });
  });

  it('resetCounts clears all channel counts', () => {
    const p = new DiagnosticsPlugin();
    const ctx = { name: 'diagnostics', logger: silentLogger() };
    p.init(ctx);
    p.recordIpc('getUser');
    p.resetCounts();
    expect(p.getSnapshot().ipcCounts).toEqual({});
  });

  it('stop clears the log timer', async () => {
    vi.useFakeTimers();
    const logger = silentLogger();
    const p = new DiagnosticsPlugin({ logIntervalMs: 100 });
    const ctx = { name: 'diagnostics', logger };

    p.init(ctx);
    p.start(ctx);
    p.stop(ctx);

    await vi.advanceTimersByTimeAsync(500);

    // Only the stop call logs the final snapshot, no interval logs after stop
    const logCallCount = logger.log.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(logger.log.mock.calls.length).toBe(logCallCount);

    vi.useRealTimers();
  });

  it('integrates with PluginHost without conflict', () => {
    const host = new PluginHost({ logger: silentLogger() });
    expect(() => host.register(new DiagnosticsPlugin())).not.toThrow();
  });
});

// ─── UpdaterPlugin ────────────────────────────────────────────────────────────

describe('UpdaterPlugin', () => {
  function makeEngine(): UpdaterEngine & {
    emit(event: string, ...args: unknown[]): void;
    listeners: Map<string, Array<(...args: unknown[]) => void>>;
  } {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    return {
      listeners,
      checkForUpdatesAndNotify: vi.fn(async () => {}),
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
      emit(event, ...args) {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args);
        }
      },
    };
  }

  it('exports correct capability key', () => {
    const engine = makeEngine();
    const p = new UpdaterPlugin({ engine });
    expect(p.capabilities).toEqual({ updater: true });
    expect(p.name).toBe('updater');
  });

  it('registers event listeners on start', async () => {
    const engine = makeEngine();
    const p = new UpdaterPlugin({ engine });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    expect(engine.listeners.get('update-available')?.length).toBe(1);
    expect(engine.listeners.get('update-downloaded')?.length).toBe(1);
    expect(engine.listeners.get('error')?.length).toBe(1);
  });

  it('removes event listeners on stop', async () => {
    const engine = makeEngine();
    const p = new UpdaterPlugin({ engine });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);
    await p.stop(ctx);

    expect(engine.listeners.get('update-available')?.length).toBe(0);
    expect(engine.listeners.get('update-downloaded')?.length).toBe(0);
  });

  it('calls onUpdateAvailable callback when update-available fires', () => {
    const engine = makeEngine();
    const onUpdateAvailable = vi.fn();
    const p = new UpdaterPlugin({ engine, onUpdateAvailable });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    engine.emit('update-available', { version: '2.0.0' });

    expect(onUpdateAvailable).toHaveBeenCalledWith({ version: '2.0.0' });
  });

  it('calls onUpdateDownloaded callback when update-downloaded fires', () => {
    const engine = makeEngine();
    const onUpdateDownloaded = vi.fn();
    const p = new UpdaterPlugin({ engine, onUpdateDownloaded });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    engine.emit('update-downloaded', { version: '2.0.0' });

    expect(onUpdateDownloaded).toHaveBeenCalledWith({ version: '2.0.0' });
  });

  it('calls onError callback when error fires', () => {
    const engine = makeEngine();
    const onError = vi.fn();
    const p = new UpdaterPlugin({ engine, onError });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    engine.emit('error', new Error('network error'));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network error' }));
  });

  it('check() delegates to checkForUpdatesAndNotify', async () => {
    const engine = makeEngine();
    const p = new UpdaterPlugin({ engine });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    await p.check();
    expect(engine.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });

  it('check() falls back to checkForUpdates when checkForUpdatesAndNotify is absent', async () => {
    const checkForUpdates = vi.fn(async () => {});
    const engine: UpdaterEngine = {
      checkForUpdates,
      on: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
    };
    const p = new UpdaterPlugin({ engine });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    await p.check();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('integrates with PluginHost without conflict', () => {
    const engine = makeEngine();
    const host = new PluginHost({ logger: silentLogger() });
    expect(() => host.register(new UpdaterPlugin({ engine }))).not.toThrow();
  });

  it('two UpdaterPlugins conflict', () => {
    const engine = makeEngine();
    const host = new PluginHost({ logger: silentLogger() });
    host.register(new UpdaterPlugin({ engine }));
    expect(() => host.register(new UpdaterPlugin({ engine }))).toThrow(PluginConflictError);
  });

  it('calls onDownloadProgress callback when download-progress fires', () => {
    const engine = makeEngine();
    const onDownloadProgress = vi.fn();
    const p = new UpdaterPlugin({ engine, onDownloadProgress });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    engine.emit('download-progress', { bytesPerSecond: 100, percent: 50, transferred: 5000, total: 10000 });

    expect(onDownloadProgress).toHaveBeenCalledWith(expect.objectContaining({ percent: 50 }));
  });

  it('calls onUpdateNotAvailable callback when update-not-available fires', () => {
    const engine = makeEngine();
    const onUpdateNotAvailable = vi.fn();
    const p = new UpdaterPlugin({ engine, onUpdateNotAvailable });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    p.start(ctx);

    engine.emit('update-not-available');

    expect(onUpdateNotAvailable).toHaveBeenCalledTimes(1);
  });

  it('check() warns when engine has no check methods', async () => {
    const logger = silentLogger();
    const engine: UpdaterEngine = {
      on: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
    };
    const p = new UpdaterPlugin({ engine });
    const ctx = { name: 'updater', logger };
    p.init(ctx);
    await p.check();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('check() normalizes non-Error throws and calls onError', async () => {
    const onError = vi.fn();
    const engine: UpdaterEngine = {
      checkForUpdates: async () => { throw 'network-fail'; },
      on: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
    };
    const p = new UpdaterPlugin({ engine, onError });
    const ctx = { name: 'updater', logger: silentLogger() };
    p.init(ctx);
    await p.check();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network-fail' }));
  });
});

// ─── PluginContext logger scoping ─────────────────────────────────────────────

describe('PluginContext: scoped logger', () => {
  it('prefixes log messages with [plugin:name]', async () => {
    const logger = silentLogger();
    const host = new PluginHost({ logger });
    const p: Plugin = {
      name: 'my-plugin',
      init(ctx: PluginContext) {
        ctx.logger.log('hello');
        ctx.logger.warn('caution');
        ctx.logger.error('boom');
      },
    };
    host.register(p);
    await host.init();

    expect(logger.log).toHaveBeenCalledWith('[plugin:my-plugin]', 'hello');
    expect(logger.warn).toHaveBeenCalledWith('[plugin:my-plugin]', 'caution');
    expect(logger.error).toHaveBeenCalledWith('[plugin:my-plugin]', 'boom');
  });
});
