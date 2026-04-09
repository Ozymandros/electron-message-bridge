# Patterns

Common real-world patterns for building Electron apps with electron-ipc-helper.

---

## Pattern 1 — Shared service functions

**Problem:** You want the same business logic callable both from a menu item and from an IPC handler. Duplicating it creates divergence bugs.

**Solution:** Extract shared logic into a plain service function. Both the IPC handler and the menu `ServiceActionDescriptor` delegate to it.

```ts
// services/fileService.ts
export async function openFolderDialog(): Promise<string | null> {
  const { dialog } = await import('electron');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return canceled ? null : (filePaths[0] ?? null);
}

// api.ts — IPC entry point
import { defineIpcApi } from 'electron-ipc-helper';
import { openFolderDialog } from './services/fileService.js';

export const api = defineIpcApi({ openFolderDialog });

// main.ts — menu entry point
import { serviceAction } from 'electron-ipc-helper/menus';
import { openFolderDialog } from './services/fileService.js';

const actions = {
  'file.open': serviceAction(openFolderDialog),
};
```

Both paths call the same function. No duplication, no coupling.

---

## Pattern 2 — HMR-safe API disposal

**Problem:** Vite (or webpack) HMR replaces modules at runtime. If the old `ipcMain.handle` handlers are not removed before the new ones register, Electron throws `Error: Attempted to register a second handler for 'channel'`.

**Solution:** Use `api.dispose()` in the HMR hot-replacement callback.

```ts
// main.ts
import { defineIpcApi } from 'electron-ipc-helper';
import { handlers } from './handlers.js';

let api = defineIpcApi(handlers);

if (import.meta.hot) {
  import.meta.hot.accept('./handlers.js', (newModule) => {
    api.dispose();                          // removes old ipcMain handlers
    api = defineIpcApi(newModule.handlers); // registers new ones
  });
}
```

---

## Pattern 3 — Multi-window event routing

**Problem:** You have multiple windows and want to push events to a specific window or broadcast to all.

**Solution:** Keep a window registry and iterate when emitting.

```ts
// windows.ts
import { BrowserWindow } from 'electron';

const registry = new Map<string, BrowserWindow>();

export function register(id: string, win: BrowserWindow): void {
  registry.set(id, win);
  win.on('closed', () => registry.delete(id));
}

export function get(id: string): BrowserWindow | undefined {
  return registry.get(id);
}

export function all(): BrowserWindow[] {
  return [...registry.values()];
}

// events.ts
import { defineIpcEvents } from 'electron-ipc-helper';
import { all } from './windows.js';

export const events = defineIpcEvents({
  syncStatus: (_status: 'idle' | 'syncing' | 'error') => {},
});

export function broadcastSyncStatus(status: 'idle' | 'syncing' | 'error'): void {
  for (const win of all()) {
    events.emit(win, 'syncStatus', status);
  }
}
```

---

## Pattern 4 — Typed constants from main to renderer

**Problem:** You want to expose read-only constants (platform, app version, feature flags) to the renderer without an IPC round-trip.

**Solution:** Use `exposeValues` in the preload script.

```ts
// preload.ts
import { app } from 'electron';
import { exposeValues } from 'electron-ipc-helper/preload';

exposeValues(
  {
    platform: process.platform,
    version: app.getVersion(),
    isDev: !app.isPackaged,
  },
  'meta',
);
```

Augment Window in the renderer:

```ts
// renderer.d.ts
declare global {
  interface Window {
    meta: {
      readonly platform: NodeJS.Platform;
      readonly version: string;
      readonly isDev: boolean;
    };
  }
}
```

Access synchronously in renderer — zero IPC:

```ts
if (window.meta.isDev) {
  console.log('Running in development mode');
}
```

---

## Pattern 5 — Graceful subprocess shutdown

**Problem:** Your app spawns a background worker (e.g., a language server, a local database). You need it to start before the renderer loads and stop cleanly on quit.

**Solution:** Use `ChildProcessLifecycle` with `autoRestart` and hook into the Electron lifecycle.

```ts
// lifecycle.ts
import { app } from 'electron';
import { ChildProcessLifecycle } from 'electron-ipc-helper/lifecycle';

export const worker = new ChildProcessLifecycle({
  command: 'node',
  args: ['dist/worker.js'],
  readyCheck: () => fetch('http://localhost:3001/health').then(() => {}),
  readyTimeoutMs: 10_000,
  autoRestart: true,
  maxRestarts: 5,
  restartDelayMs: 2_000,
  logger: console,
});

worker.on('ready',   ()     => console.log('[worker] ready'));
worker.on('crashed', (info) => console.warn('[worker] crashed', info));
worker.on('failed',  (err)  => console.error('[worker] failed:', err.message));

app.whenReady().then(() => worker.start());
app.on('before-quit', async (e) => {
  e.preventDefault();
  await worker.stop();
  app.quit();
});
```

---

## Pattern 6 — Plugin-managed window state

**Problem:** You want the app window to re-open at the same size and position it was closed at, with minimal boilerplate.

**Solution:** Use `WindowStatePlugin` from the plugins module.

```ts
// main.ts
import { BrowserWindow } from 'electron';
import { PluginHost } from 'electron-ipc-helper/plugins';
import { WindowStatePlugin } from 'electron-ipc-helper/plugins/window-state';

const windowState = new WindowStatePlugin({ key: 'main' });
const host = new PluginHost({ logger: console });
host.register(windowState);

let win: BrowserWindow;

app.whenReady().then(async () => {
  await host.init();

  win = new BrowserWindow({
    ...windowState.getBounds(), // restore last position
    webPreferences: { contextIsolation: true, preload: '...' },
  });
  windowState.attach(win);     // starts saving on resize/move

  await host.start();
});

app.on('before-quit', async () => {
  await host.stop();    // flushes window state to disk
  await host.dispose();
});
```

---

## Pattern 7 — Declarative menu with typed actions

**Problem:** You want to define your application menu in a YAML file (editable by non-engineers) while keeping the action handlers fully typed.

**Solution:** Use `applyApplicationMenuFromFile` with an `ActionRegistry`.

```yaml
# menu.yaml
- label: File
  submenu:
    - label: Open Folder...
      actionId: file.open
      accelerator: CmdOrCtrl+O
    - type: separator
    - label: Quit
      role: quit
```

```ts
// menus.ts
import { applyApplicationMenuFromFile, commandAction, serviceAction } from 'electron-ipc-helper/menus';
import { openFolderDialog } from './services/fileService.js';

await applyApplicationMenuFromFile('./menu.yaml', {
  actions: {
    'file.open': serviceAction(openFolderDialog),
  },
  onAction: (id) => analytics.track('menu_click', { id }),
});
```

---

## Pattern 8 — IPC diagnostics in development

**Problem:** You want visibility into how often each IPC channel is called during development.

**Solution:** Use `DiagnosticsPlugin` and expose the snapshot via an IPC handler in development builds.

```ts
// main.ts
import { DiagnosticsPlugin } from 'electron-ipc-helper/plugins/diagnostics';
import { defineIpcApi } from 'electron-ipc-helper';

const diagnostics = new DiagnosticsPlugin();

const api = defineIpcApi({
  getUser: async (id: string) => {
    diagnostics.recordIpc('getUser');
    return db.getUser(id);
  },

  ...(isDev ? {
    _getDiagnostics: async () => diagnostics.getSnapshot(),
  } : {}),
});
```
