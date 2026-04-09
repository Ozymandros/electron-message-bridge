# Quickstart

Get a typed, zero-boilerplate Electron IPC bridge running in under 5 minutes.

---

## Prerequisites

- Node.js ≥ 18
- An Electron project (v20+) with TypeScript
- `contextIsolation: true` and `sandbox: true` in `BrowserWindow.webPreferences`

---

## Install

```bash
npm install electron-ipc-helper
# or
pnpm add electron-ipc-helper
```

---

## Step 1 — Define the API in the main process

Create `src/api.ts` (or anywhere in the main process):

```ts
// src/api.ts — main process
import { defineIpcApi } from 'electron-ipc-helper';

export const api = defineIpcApi({
  getUser:      async (id: string)       => db.getUser(id),
  saveSettings: async (s: UserSettings)  => db.saveSettings(s),
  ping:         async ()                 => 'pong' as const,
});
```

`defineIpcApi` registers `ipcMain.handle` for each key automatically. The returned `api` handle carries the full types as a phantom parameter — you never need to annotate types manually.

---

## Step 2 — Expose the API in the preload script

```ts
// src/preload.ts — preload script
import { exposeApiToRenderer } from 'electron-ipc-helper/preload';
import { api } from './api.js';

exposeApiToRenderer(api);
// → window.api is now available in the renderer
```

Import this from `electron-ipc-helper/preload`, not the root. The two entry points are separate to prevent bundler cross-contamination.

---

## Step 3 — Call it from the renderer

Add type declarations so TypeScript knows what `window.api` looks like:

```ts
// src/renderer.d.ts
import type { api } from './api.js';
import type { ExtractRendererApi } from 'electron-ipc-helper';

declare global {
  interface Window {
    api: ExtractRendererApi<typeof api>;
  }
}
```

Now call it with full type safety:

```ts
// renderer script
const user = await window.api.getUser('user-123');
//    ^? User — fully typed, no manual annotation

await window.api.saveSettings({ theme: 'dark' });
```

No `ipcRenderer`, no channel strings, no boilerplate.

---

## Step 4 — Configure your BrowserWindow

```ts
// main.ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import './api.js'; // registers handlers on import

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      contextIsolation: true,   // required
      sandbox: true,            // recommended
      preload: join(__dirname, 'preload.js'),
    },
  });
  win.loadFile('index.html');
});
```

---

## Push events (optional)

Push events let the main process notify the renderer without the renderer polling.

```ts
// src/events.ts — main process
import { defineIpcEvents } from 'electron-ipc-helper';

export const events = defineIpcEvents({
  // descriptor functions — parameters define the payload type
  fileChanged: (_path: string) => {},
  syncStatus:  (_status: 'idle' | 'syncing' | 'error') => {},
});

// Emit to a window:
events.emit(mainWindow, 'fileChanged', '/home/user/doc.txt');
```

Expose to renderer in preload:

```ts
import { exposeEventsToRenderer } from 'electron-ipc-helper/preload';
import { events } from './events.js';

exposeEventsToRenderer(events);
// → window.events.fileChanged(callback) in renderer
```

Subscribe in renderer:

```ts
const unsubscribe = window.events.fileChanged((path) => {
  console.log('File changed:', path);
});

// Later, clean up:
unsubscribe();
```

---

## Scaffold a new project

Use the scaffolding CLI to bootstrap a project with all the boilerplate pre-configured:

```bash
npx create-electron-ipc-app my-app
cd my-app && npm install && npm run build && npm start
```

See the [CLI docs](./cli.md) for template options and non-interactive mode.

---

## Next steps

- [Architecture overview](./architecture.md) — understand the layered model
- [Patterns](./patterns.md) — common real-world patterns
- [Security](./security.md) — hardening checklist
- [API reference](./api-reference.md) — full API documentation
