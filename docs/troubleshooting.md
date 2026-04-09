# Troubleshooting

Common issues and their resolutions.

---

## Error: Attempted to register a second handler for 'channelName'

**Cause:** `defineIpcApi` was called twice for the same channel without calling `api.dispose()` first. This typically happens during Vite/webpack HMR module replacement.

**Fix:** Store the `api` handle and call `dispose()` before re-registering:

```ts
let api = defineIpcApi(handlers);

if (import.meta.hot) {
  import.meta.hot.accept('./handlers.js', (newModule) => {
    api.dispose();
    api = defineIpcApi(newModule.handlers);
  });
}
```

---

## `window.api` is `undefined` in the renderer

**Cause (most common):** The preload script path in `BrowserWindow.webPreferences.preload` is wrong, or the preload script is not being compiled.

**Fix:**
1. Confirm the compiled preload file exists at the path you specified.
2. Use an absolute path: `preload: join(__dirname, 'preload.js')`.
3. Check the Electron DevTools console for preload errors.
4. Check that `contextIsolation: true` is set (required for `contextBridge`).

**Cause (secondary):** You imported `exposeApiToRenderer` from `electron-ipc-helper` (root) instead of `electron-ipc-helper/preload`.

```ts
// Wrong — imports from main-process entry, contextBridge may not be available
import { exposeApiToRenderer } from 'electron-ipc-helper';

// Correct
import { exposeApiToRenderer } from 'electron-ipc-helper/preload';
```

---

## TypeScript: `window.api` type is `any` or missing

**Cause:** The `renderer.d.ts` augmentation file is not included in your renderer TypeScript config.

**Fix:** Add the file to your renderer `tsconfig.json`:

```json
{
  "include": ["src", "src/renderer.d.ts"]
}
```

Or reference it explicitly:

```ts
// renderer.ts
/// <reference path="./renderer.d.ts" />
```

---

## `PluginConflictError` on startup

**Cause:** Two plugins declare the same capability key (e.g., two `UpdaterPlugin` instances).

**Fix:** Check your `PluginHost.register(...)` calls. Each capability key must be unique across all registered plugins. Remove the duplicate plugin or create a custom plugin that wraps both behaviours.

---

## `ChildProcessLifecycle` never emits `ready`

**Cause (most common):** The `readyCheck` function throws or never resolves, and `readyTimeoutMs` is not set (defaults to 30 seconds).

**Fix:**
1. Confirm your `readyCheck` actually resolves when the process is ready.
2. Add error logging inside `readyCheck` to diagnose failures.
3. Reduce `readyTimeoutMs` to get faster feedback during development.

**Cause (secondary):** The spawned process exits immediately (bad command, wrong `cwd`, missing binary).

**Fix:** Listen for `crashed` to see the exit code:
```ts
lifecycle.on('crashed', (info) => console.error('Crashed:', info));
```

---

## Menu actions do nothing when clicked

**Cause:** The `actionId` in the YAML/JSON spec does not match any key in the `actions` or `commands` registry.

**Fix:** Check for typos. A `console.warn` is emitted when an `actionId` is unregistered (if a registry is provided):

```
[electron-ipc-helper] No action registered for actionId "file.opn".
Add it to the "actions" registry or remove it from the menu spec.
```

---

## pnpm / CI issues

**`ERR_PNPM_NO_LOCKFILE` in CI:** Run `pnpm install --frozen-lockfile` to reproduce the CI environment locally. If the lockfile is outdated, run `pnpm install` locally and commit the updated `pnpm-lock.yaml`.

**tsup EPERM on network/mounted filesystems:** tsup writes temp files to the source directory. If running on a mounted filesystem (e.g., WSL2 network mount), copy the project to a local path first.

---

## TypeScript: `Type 'IpcApi<...>' is not assignable to parameter`

**Cause:** You are passing a raw handler map where an `IpcApi<T>` handle is expected, or vice versa.

**Fix:** Always pass the handle returned by `defineIpcApi` to `exposeApiToRenderer`. Do not pass the raw handlers object directly.

```ts
// Wrong
exposeApiToRenderer({ getUser: async (id) => ... });

// Correct
const api = defineIpcApi({ getUser: async (id) => ... });
exposeApiToRenderer(api);
```
