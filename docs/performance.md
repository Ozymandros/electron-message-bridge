# Performance Guide

Understanding and optimising the performance of electron-ipc-helper in production Electron applications.

---

## Performance model

electron-ipc-helper's overhead is confined to three areas:

| Area | Cost | Notes |
|---|---|---|
| Handler registration | One-time at startup | Negligible — O(n) Object.keys + ipcMain.handle |
| IPC invoke dispatch | Per call | Library adds < 0.01 ms; network round-trip dominates |
| Push event emission | Per event | Direct `webContents.send`; no library overhead |
| Plugin lifecycle | One-time at init/start | Proportional to number of plugins |

The primary performance variable in a real app is **the handler implementation**, not the library overhead.

---

## Budget targets

These targets are enforced in CI via `vitest bench` (see `benchmarks/ipc.bench.ts`):

| Benchmark | Budget |
|---|---|
| Register 10 handlers | < 1 ms |
| Single async handler invocation | < 0.01 ms library overhead |
| Register 10 event channels | < 1 ms |
| PluginHost init+start+stop+dispose for 5 plugins | < 5 ms |

If a benchmark regresses beyond its budget, the CI check fails.

---

## Running benchmarks

```bash
# Run all benchmarks
pnpm vitest bench

# Run a specific benchmark file
pnpm vitest bench benchmarks/ipc.bench.ts
```

---

## IPC throughput optimisations

### Batch calls instead of chattering

Instead of making many small IPC calls in sequence, batch them into one:

```ts
// Slow — N round-trips
for (const id of ids) {
  const user = await window.api.getUser(id);
}

// Fast — 1 round-trip
const api = defineIpcApi({
  getUsers: async (ids: string[]) => Promise.all(ids.map(db.getUser)),
});
const users = await window.api.getUsers(ids);
```

### Prefer push events for high-frequency data

For high-frequency updates (progress, metrics, logs), use push events instead of polling via IPC invoke:

```ts
// Polling (wasteful)
setInterval(async () => {
  const progress = await window.api.getProgress();
  updateUI(progress);
}, 100);

// Push (efficient)
const events = defineIpcEvents({
  progress: (_pct: number) => {},
});

// In main process, push when state changes:
events.emit(win, 'progress', 42);

// In renderer:
window.events.progress((pct) => updateUI(pct));
```

### Avoid large serialised payloads

Electron's IPC uses structured clone. Large objects, deeply nested trees, or large binary payloads are expensive to serialise. For large binary data, use `nativeImage`, `Buffer`, or consider a different transport (shared memory, file).

---

## Startup performance

`defineIpcApi` and `defineIpcEvents` are synchronous and fast. But lazy loading of handlers can reduce cold-start time in large apps:

```ts
// Eager (default) — handlers registered immediately on import
import { defineIpcApi } from 'electron-ipc-helper';
import { heavyHandler } from './heavyModule.js'; // loaded immediately

const api = defineIpcApi({ heavyHandler });

// Lazy — handler body deferred until first call
const api = defineIpcApi({
  heavyHandler: async (...args) => {
    const { heavyHandler } = await import('./heavyModule.js');
    return heavyHandler(...args);
  },
});
```

Lazy loading defers the module parse/init cost until the handler is first invoked.

---

## Child process lifecycle performance

When using `ChildProcessLifecycle`, use `readyCheck` to wait until the subprocess is genuinely ready before the app renders. This prevents the renderer from making IPC calls before handlers are available.

```ts
const worker = new ChildProcessLifecycle({
  command: 'node',
  args: ['worker.js'],
  readyCheck: async () => {
    // Probe until ready — exponential backoff is implemented internally
    const res = await fetch('http://localhost:3001/health');
    if (!res.ok) throw new Error('not ready');
  },
  readyTimeoutMs: 15_000,
});

// Don't create the BrowserWindow until the worker is ready:
await worker.start();
createWindow();
```

---

## Plugin performance

Plugins add lifecycle overhead proportional to the number of registered plugins. Best practices:

- Keep plugin `init`/`start` hooks fast (< 10 ms each). Move slow work to lazy initialisation inside the plugin.
- Use `logIntervalMs: 0` (default) on `DiagnosticsPlugin` in production to avoid timer overhead.
- Dispose plugins explicitly on `before-quit` to avoid Electron's atexit cleanup overhead.

---

## Measuring real-world performance

Use Electron's built-in `chrome://tracing` or the `electron-chrome-extension` for profiling the renderer. For the main process, use Node.js's `--prof` flag:

```bash
electron --prof your-app.js
# Then process the V8 log:
node --prof-process isolate-*.log > profile.txt
```

For IPC-specific profiling, `DiagnosticsPlugin.getSnapshot()` provides per-channel call counts that you can correlate with wall-clock time.
