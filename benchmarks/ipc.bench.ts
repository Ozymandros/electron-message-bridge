/**
 * IPC throughput and latency benchmarks.
 *
 * These benchmarks measure the overhead introduced by electron-ipc-helper's
 * handler registration and dispatch path — not the full Electron IPC round-trip
 * (which requires a live Electron process and is measured separately).
 *
 * The benchmarks simulate the in-process cost:
 * - Handler registration via defineIpcApi
 * - Direct handler invocation via the registered function
 * - defineIpcEvents channel setup
 *
 * Run with: vitest bench
 *
 * Budget targets (CI gates):
 * - Handler registration for 10 channels: < 1 ms
 * - Single handler invocation round-trip: < 0.01 ms
 * - defineIpcEvents for 10 channels: < 1 ms
 */

import { bench, describe, afterAll } from 'vitest';
import { ipcMain, resetMocks } from '../tests/__mocks__/electron.js';

// Vitest aliases 'electron' to the mock via vitest.config.ts
// For bench files we import it explicitly to satisfy the module resolver
const _ipcMain = ipcMain; void _ipcMain;

afterAll(() => {
  resetMocks();
});

// ─── Mock-based handler registration benchmarks ───────────────────────────────

describe('defineIpcApi registration', () => {
  bench('register 1 handler', async () => {
    const { defineIpcApi } = await import('../src/main.js');
    resetMocks();
    defineIpcApi({ ping: async () => 'pong' });
  });

  bench('register 10 handlers', async () => {
    const { defineIpcApi } = await import('../src/main.js');
    resetMocks();
    defineIpcApi({
      h1: async () => 1, h2: async () => 2, h3: async () => 3,
      h4: async () => 4, h5: async () => 5, h6: async () => 6,
      h7: async () => 7, h8: async () => 8, h9: async () => 9,
      h10: async () => 10,
    });
  });
});

// ─── Handler invocation benchmarks ───────────────────────────────────────────

describe('handler invocation (mocked ipcMain)', () => {
  bench('single async handler invocation', async () => {
    const { defineIpcApi } = await import('../src/main.js');
    resetMocks();
    defineIpcApi({ compute: async (n: number) => n * 2 });

    const handler = ipcMain._handlers.get('compute')!;
    await handler({}, 21);
  });

  bench('10 concurrent handler invocations', async () => {
    const { defineIpcApi } = await import('../src/main.js');
    resetMocks();
    defineIpcApi({ echo: async (x: unknown) => x });

    const handler = ipcMain._handlers.get('echo')!;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => handler({}, i)),
    );
  });
});

// ─── defineIpcEvents benchmarks ───────────────────────────────────────────────

describe('defineIpcEvents registration', () => {
  bench('register 1 event channel', async () => {
    const { defineIpcEvents } = await import('../src/main.js');
    defineIpcEvents({ ping: (_n: number) => {} });
  });

  bench('register 10 event channels', async () => {
    const { defineIpcEvents } = await import('../src/main.js');
    defineIpcEvents({
      e1: (_: number) => {}, e2: (_: number) => {}, e3: (_: number) => {},
      e4: (_: number) => {}, e5: (_: number) => {}, e6: (_: number) => {},
      e7: (_: number) => {}, e8: (_: number) => {}, e9: (_: number) => {},
      e10: (_: number) => {},
    });
  });
});

// ─── PluginHost lifecycle benchmarks ─────────────────────────────────────────

describe('PluginHost lifecycle', () => {
  bench('init+start+stop+dispose for 5 no-op plugins', async () => {
    const { PluginHost } = await import('../src/plugins.js');
    const host = new PluginHost({ logger: { log: () => {}, warn: () => {}, error: () => {} } });

    for (let i = 0; i < 5; i++) {
      host.register({ name: `plugin-${i}` });
    }

    await host.init();
    await host.start();
    await host.stop();
    await host.dispose();
  });
});
