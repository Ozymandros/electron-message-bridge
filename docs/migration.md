# Migration Guide

Step-by-step guides for migrating to electron-message-bridge from bare Electron IPC or earlier library versions.

---

## Migrating AssemblyScript adapter to standalone package (v0.1.x → v0.2.x)

The AssemblyScript / WASM adapter has been extracted from the core package into
the standalone package **`electron-message-bridge-adapter-assemblyscript`**. This
keeps the core bundle lean for the majority of users who don't need WASM.

### Why this change?

- Core stays small — no WASM-related code in the default install.
- The adapter can evolve independently.
- Makes the optional nature of AssemblyScript support explicit.

### Step 1 — Install the new package

```bash
# npm
npm install electron-message-bridge-adapter-assemblyscript

# pnpm
pnpm add electron-message-bridge-adapter-assemblyscript

# yarn
yarn add electron-message-bridge-adapter-assemblyscript
```

### Step 2 — Update your imports

```ts
// ❌ Old import path (deprecated — works in 0.1.x via shim, removed in 0.2.x)
import {
  createAssemblyScriptAdapter,
  AssemblyScriptPlugin,
  asc,
} from 'electron-message-bridge/adapters/assemblyscript';

// ✅ New import path
import {
  createAssemblyScriptAdapter,
  AssemblyScriptPlugin,
  asc,
} from 'electron-message-bridge-adapter-assemblyscript';
```

No API changes — the function signatures, types, and behaviour are identical.

### Compatibility shim

During the transition release (`0.1.x`), the old import path
`electron-message-bridge/adapters/assemblyscript` continues to work as a thin
re-export shim. It will be **removed in the next major release**.

To silence editor warnings about the deprecated path, switch to the new
import as soon as possible.

---

## Migrating from bare Electron IPC

If you're currently writing `ipcMain.handle` / `ipcRenderer.invoke` / `contextBridge.exposeInMainWorld` manually, this guide shows you how to replace that boilerplate.

### Before (manual)

```ts
// main.ts
ipcMain.handle('get-user', async (_event, id: string) => {
  return db.getUser(id);
});
ipcMain.handle('save-settings', async (_event, settings: UserSettings) => {
  return db.saveSettings(settings);
});

// preload.ts
contextBridge.exposeInMainWorld('api', {
  getUser: (id: string) => ipcRenderer.invoke('get-user', id),
  saveSettings: (s: UserSettings) => ipcRenderer.invoke('save-settings', s),
});

// renderer.ts — no type safety
const user = await window.api.getUser('123'); // any
```

### After (electron-message-bridge)

```ts
// api.ts — main process
import { defineIpcApi } from 'electron-message-bridge';

export const api = defineIpcApi({
  getUser:      async (id: string)      => db.getUser(id),
  saveSettings: async (s: UserSettings) => db.saveSettings(s),
});

// preload.ts
import { exposeApiToRenderer } from 'electron-message-bridge/preload';
import { api } from './api.js';
exposeApiToRenderer(api);

// renderer.d.ts
import type { api } from './api.js';
import type { ExtractRendererApi } from 'electron-message-bridge';
declare global {
  interface Window { api: ExtractRendererApi<typeof api>; }
}

// renderer.ts — fully typed
const user = await window.api.getUser('123'); // User
```

**Key differences:**

- Channel names disappear — they are derived from the handler key names.
- No manual `contextBridge.exposeInMainWorld` call.
- The renderer gets full TypeScript inference automatically.

---

## Migrating push events

### Before (manual)

```ts
// main.ts
win.webContents.send('file-changed', '/path/to/file');

// preload.ts
contextBridge.exposeInMainWorld('events', {
  onFileChanged: (cb: (p: string) => void) =>
    ipcRenderer.on('file-changed', (_e, p) => cb(p)),
});
// ⚠️ No unsubscribe, no type safety
```

### After

```ts
// events.ts — main process
import { defineIpcEvents } from 'electron-message-bridge';

export const events = defineIpcEvents({
  fileChanged: (_path: string) => {},
});

// Push from anywhere in main:
events.emit(win, 'fileChanged', '/path/to/file');

// preload.ts
import { exposeEventsToRenderer } from 'electron-message-bridge/preload';
import { events } from './events.js';
exposeEventsToRenderer(events);

// renderer.ts
const off = window.events.fileChanged((path) => console.log(path));
// Returns an unsubscribe function — no memory leaks
```

---

## Migrating from an older version of this library

### 0.0.x → 0.1.x

**`defineIpcApi` return type changed** (0.0.x returned `void`; 0.1.x returns an `IpcApi<T>` handle).

```ts
// Before
defineIpcApi({ getUser: async (id) => db.getUser(id) });

// After — store the handle for dispose()
const api = defineIpcApi({ getUser: async (id) => db.getUser(id) });
// api.dispose() is now available for HMR
```

**`exposeApiToRenderer` no longer accepts a raw handler map** — it only accepts an `IpcApi<T>` handle.

```ts
// Before (0.0.x)
exposeApiToRenderer({ getUser: ..., saveSettings: ... });

// After (0.1.x) — pass the handle returned by defineIpcApi
const api = defineIpcApi({ getUser: ..., saveSettings: ... });
exposeApiToRenderer(api);
```

**Menus: `commands` registry is deprecated** in favour of the typed `actions` registry.

```ts
// Deprecated (still works, logs no warning unless registry is present)
buildMenuTemplate(items, {
  commands: { 'file.open': () => openDialog() },
});

// Preferred
import { serviceAction } from 'electron-message-bridge/menus';

buildMenuTemplate(items, {
  actions: { 'file.open': serviceAction(openDialog) },
});
```

---

## Migrating to the Plugin system

If you have ad-hoc startup/shutdown code in `app.whenReady` and `app.before-quit`, wrap it in plugins for better organisation and error isolation.

### Before

```ts
app.whenReady().then(async () => {
  await windowState.load();
  await diagnostics.init();
  // ... lots of init code
});

app.on('before-quit', async (e) => {
  e.preventDefault();
  await windowState.save();
  await diagnostics.flush();
  app.quit();
});
```

### After

```ts
import { PluginHost } from 'electron-message-bridge/plugins';
import { WindowStatePlugin } from 'electron-message-bridge/plugins/window-state';
import { DiagnosticsPlugin } from 'electron-message-bridge/plugins/diagnostics';

const host = new PluginHost({ logger: console });
host.register(new WindowStatePlugin({ key: 'main' }));
host.register(new DiagnosticsPlugin());

app.whenReady().then(async () => {
  await host.init();
  await host.start();
});

app.on('before-quit', async (e) => {
  e.preventDefault();
  await host.stop();
  await host.dispose();
  app.quit();
});
```

Benefits: error isolation per plugin, consistent lifecycle order, easier testing.

