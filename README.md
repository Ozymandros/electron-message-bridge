# electron-ipc-helper

[![CI](https://github.com/your-org/electron-ipc-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/electron-ipc-helper/actions/workflows/ci.yml)
[![CodeQL](https://github.com/your-org/electron-ipc-helper/actions/workflows/codeql.yml/badge.svg)](https://github.com/your-org/electron-ipc-helper/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/electron-ipc-helper)](https://www.npmjs.com/package/electron-ipc-helper)
[![license](https://img.shields.io/npm/l/electron-ipc-helper)](LICENSE)

---

## Introduction

A small, typed, zero‑boilerplate Electron IPC library that gives you a clean, safe, and fully typed IPC layer without the usual wiring or runtime overhead. It provides **end‑to‑end type inference** across main, preload, and renderer—**no `any` leakage**, no manual channel plumbing, and no hidden abstractions.

### Why this library?

- **Zero boilerplate** — abstracts all IPC setup for main, preload, and renderer.  
- **Fully typed** — complete type inference across processes with friendly TS autocompletion.  
- **Context‑isolation ready** — works seamlessly with sandboxing and secure preload bridges.  
- **Decoupled design** — channel names and handler logic stay separate for maintainability and security.  
- **Composable** — define multiple APIs and event sets without conflicts.  
- **Safe by default** — guaranteed cleanup of handlers and listeners to prevent memory leaks.  
- **Hot‑reload friendly** — explicit `dispose()` methods and Vite HMR integration.  
- **Lightweight** — no dependencies, minimal API surface, and zero runtime cost beyond Electron’s IPC.  
- **Framework‑agnostic** — works with React, Vue, Svelte, Solid, vanilla JS, or anything else.  
- **Well‑tested** — unit tests cover core behavior and edge cases, with CI to prevent regressions.

### Modular by design

Use only what you need:

- **Core IPC helper** — import from the root package.  
- **Optional modules** — import separately when needed:
  - `integrations` — helpers for Electron modules like `dialog` and `shell`.  
  - `menus` — declarative menu definitions.  
  - `appkit` — common app utilities.  
  - `lifecycle` — child‑process lifecycle helpers.

Nothing outside the core is required.

For optional adapters (for example AssemblyScript), install the adapter package directly.

### Perfect for…

- New Electron apps that want a clean, maintainable IPC layer from day one.  
- Existing apps that want to gradually replace manual `ipcMain`/`ipcRenderer` code with a typed, safer alternative.  
- Teams that value type safety, predictable architecture, and minimal boilerplate.

### What you get

- A tiny, focused API that’s easy to learn.  
- Strong TypeScript guidance everywhere.  
- Cleaner main and preload scripts—focused on app logic, not IPC wiring.  
- Fewer IPC bugs, less maintenance overhead, and a more scalable architecture.

---

## Features

| Feature | Description |
|---|---|
| `defineIpcApi` | Register typed request/response handlers in the main process |
| `exposeApiToRenderer` | Bridge the API to the renderer via `contextBridge` |
| `defineIpcEvents` | Define typed push events (main → renderer) |
| `exposeEventsToRenderer` | Subscribe to push events with built-in cleanup |
| `exposeValues` | Expose static read-only constants to the renderer |
| `menus` subpath | Load declarative JSON/YAML menus and build Electron templates |
| `appkit` subpath | Glue IPC + integrations + menus setup in one place |
| `lifecycle` subpath | Supervise child process lifecycle with restart and readiness checks |
| `dispose()` | Remove all registered handlers from `ipcMain` |

---

## Installation

```bash
pnpm add electron-ipc-helper
```

`electron` must be installed separately as a peer dependency.

---

## Docker integration mock (optional)

This repo ships a lightweight backend mock image for integration testing.

```bash
pnpm run docker:mock:up
```

The mock service listens on `http://localhost:4010`.

Stop and clean up:

```bash
pnpm run docker:mock:down
```

Full details: `docs/docker-integration.md`.

Run the integration suite:

```bash
pnpm run test:integration
```

---

## Quick start

### 1 — Define the API in the main process

```ts
// src-electron/api.ts
import { defineIpcApi } from 'electron-ipc-helper';
import { db } from './db';

export const api = defineIpcApi({
  getUser:      async (id: string)       => db.users.findById(id),
  saveSettings: async (s: UserSettings)  => db.settings.save(s),
  ping:         async ()                 => 'pong' as const,
});
```

### 2 — Define push events in the main process

```ts
// src-electron/events.ts
import { defineIpcEvents } from 'electron-ipc-helper';

export const events = defineIpcEvents({
  backendReady:   (_code: number)                            => {},
  folderSelected: (_path: string)                            => {},
  backendCrashed: (_code: number | null, _sig: string | null) => {},
});
```

### 3 — Bridge everything in the preload script

```ts
// preload.ts
import { exposeApiToRenderer, exposeEventsToRenderer, exposeValues } from 'electron-ipc-helper/preload';
import { api }    from './api';
import { events } from './events';

// window.api  — typed request/response methods
exposeApiToRenderer(api);

// window.events — typed push-event subscriptions
exposeEventsToRenderer(events);

// window.meta — static constants (no Node.js leakage)
exposeValues({ platform: process.platform }, 'meta');
```

### 4 — Augment `Window` in the renderer

```ts
// renderer.d.ts
import type { api }    from '../src-electron/api';
import type { events } from '../src-electron/events';
import type {
  ExtractRendererApi,
  ExtractRendererEvents,
} from 'electron-ipc-helper';

declare global {
  interface Window {
    api:    ExtractRendererApi<typeof api>;
    events: ExtractRendererEvents<typeof events>;
    meta:   { platform: NodeJS.Platform };
  }
}
```

### 5 — Call from the renderer

```ts
// Any renderer file — fully typed, no IPC boilerplate
const user = await window.api.getUser('42');
//    ^? { id: string; name: string }

const unsub = window.events.folderSelected((path) => {
  console.log('folder opened:', path);
});

// Clean up when the component unmounts
unsub();
```

---

## API reference

### `defineIpcApi(handlers)` — main process

Registers each key of `handlers` as an `ipcMain.handle` channel.

```ts
import { defineIpcApi } from 'electron-ipc-helper';

const api = defineIpcApi({
  myMethod: async (arg: string) => `hello ${arg}`,
});

// Dispose (remove all handlers) when done
api.dispose();
```

| Parameter | Type | Description |
|---|---|---|
| `handlers` | `Record<string, (...args) => Promise<any>>` | Handler object — every value must be an async function |

Returns an `IpcApi<T>` handle. The `_channels` array is frozen; no new channels can be injected after creation.

**Safety**
- The `IpcMainInvokeEvent` is never forwarded to your handlers.
- Channel names are derived solely from object keys at call time.

---

### `api.dispose()` — main process

Calls `ipcMain.removeHandler` for every channel registered by this `IpcApi`. Idempotent; safe to call multiple times.

```ts
// Useful in Vite hot-reload setups
if (import.meta.hot) {
  import.meta.hot.accept(() => api.dispose());
}
```

---

### `defineIpcEvents(schema)` — main process

Declares a set of typed push events. Schema values are **descriptor functions** — they are never called; they exist only so TypeScript can infer parameter types.

```ts
import { defineIpcEvents } from 'electron-ipc-helper';

const events = defineIpcEvents({
  backendReady:   (_code: number)   => {},
  folderSelected: (_path: string)   => {},
});

// Send a push event to a BrowserWindow
events.emit(browserWindow, 'backendReady', 0);
```

| Method | Description |
|---|---|
| `events.emit(win, channel, ...args)` | Sends `webContents.send(channel, ...args)` — fully type-checked |

---

### `exposeApiToRenderer(api[, key])` — preload

Exposes the typed request/response API to the renderer via `contextBridge.exposeInMainWorld`.

```ts
exposeApiToRenderer(api);          // → window.api
exposeApiToRenderer(api, 'myApp'); // → window.myApp
```

---

### `exposeEventsToRenderer(events[, key])` — preload

Exposes typed push-event subscription functions to the renderer.
Each exposed function returns an **unsubscribe** callback.

```ts
exposeEventsToRenderer(events);           // → window.events
exposeEventsToRenderer(events, 'notify'); // → window.notify
```

**Renderer usage:**
```ts
const unsub = window.events.backendReady((code) => {
  console.log('ready, exit code:', code);
});

// Remove the listener (prevents memory leaks)
unsub();
```

The `IpcRendererEvent` injected by Electron is stripped before your callback receives its arguments.

---

### `exposeValues(values, key)` — preload

Exposes a plain object of static serialisable values to the renderer without leaking any Node.js globals.

```ts
import { app } from 'electron';

exposeValues(
  { platform: process.platform, version: app.getVersion() },
  'meta',
);
// Renderer: window.meta.platform, window.meta.version
```

---

## Composing multiple APIs

If your app has separate feature areas, define each with its own `defineIpcApi` call and expose them under different keys:

```ts
// preload.ts
exposeApiToRenderer(userApi,     'userApi');
exposeApiToRenderer(settingsApi, 'settingsApi');
exposeEventsToRenderer(appEvents, 'appEvents');
```

```ts
// renderer.d.ts
interface Window {
  userApi:     ExtractRendererApi<typeof userApi>;
  settingsApi: ExtractRendererApi<typeof settingsApi>;
  appEvents:   ExtractRendererEvents<typeof appEvents>;
}
```

---

## Declarative Menus (JSON/YAML)

Use the optional menus module when you want to define Electron menus in config
files and map menu actions to app callbacks.

Example `config/menu.yaml`:

```yaml
items:
  - label: File
    submenu:
      - label: Open...
        accelerator: CmdOrCtrl+O
        actionId: file.open
      - type: separator
      - role: quit
  - label: Help
    submenu:
      - label: Documentation
        actionId: help.docs
```

```ts
import {
  applyApplicationMenuFromFile,
  buildMenuTemplate,
  loadMenuSpecFromFile,
} from 'electron-ipc-helper/menus';

const spec = await loadMenuSpecFromFile('config/menu.yaml');

const commands: Record<string, () => void> = {
  'file.open': () => {
    // open file flow
  },
  'help.docs': () => {
    // open docs URL
  },
};

const template = buildMenuTemplate(spec.items, {
  commands,
  onAction: (actionId) => {
    // optional global hook (logging/analytics)
    console.log('menu action:', actionId);
  },
});

// Or do all steps at once:
await applyApplicationMenuFromFile('config/menu.yaml', {
  commands,
  onAction: (actionId) => {
    console.log('menu action:', actionId);
  },
});
```

---

## AppKit (Optional Glue Layer)

Use `electron-ipc-helper/appkit` when you want one setup flow that composes
core IPC, optional integrations, and optional menus.

```ts
// main.ts
import { setupMainAppKit } from 'electron-ipc-helper/appkit';

const appkit = await setupMainAppKit({
  apiHandlers: {
    ping: async () => 'pong' as const,
  },
  eventSchema: {
    ready: (_code: number) => {},
  },
  dialogs: true,
  shell: true,
  menu: {
    filePath: 'config/menu.yaml',
    commands: {
      'file.open': () => {
        console.log('open requested');
      },
    },
  },
});

// Later at shutdown/hot-reload
appkit.dispose();
```

```ts
// preload.ts
import { setupPreloadAppKit } from 'electron-ipc-helper/appkit';

setupPreloadAppKit({
  api: appkit.api,
  events: appkit.events,
  values: { platform: process.platform },
  dialogs: true,
  shell: true,
});
```

---

## Child Process Lifecycle

Use `electron-ipc-helper/lifecycle` to supervise a backend process from the
main process with optional readiness checks and bounded auto-restarts.

```ts
import { ChildProcessLifecycle } from 'electron-ipc-helper/lifecycle';

const lifecycle = new ChildProcessLifecycle({
  command: 'dotnet',
  args: ['run', '--project', 'MyBackend'],
  readyCheck: async () => {
    // Replace with your own health check (pipe/socket/http probe).
  },
  maxRestarts: 3,
  restartDelayMs: 1_000,
});

lifecycle.on('ready', () => {
  console.log('backend ready');
});

lifecycle.on('crashed', (info) => {
  console.warn('backend crashed', info.code, info.signal);
});

lifecycle.on('failed', (reason) => {
  console.error('backend failed permanently', reason.message);
});

await lifecycle.start();

// Later during shutdown:
await lifecycle.stop();
```

---

## Hot-reload / Vite integration

Call `dispose()` to remove handlers before the module is replaced:

```ts
// api.ts (main process, Vite HMR setup)
export const api = defineIpcApi({ /* ... */ });

if (import.meta.hot) {
  import.meta.hot.dispose(() => api.dispose());
}
```

---

## Security

- `contextIsolation: true` and `sandbox: true` are fully supported.
- `ipcRenderer` is never exposed to the renderer.
- Channel names are derived from object keys at registration time. Dynamic or injected channel strings are not possible.
- `IpcMainInvokeEvent` and `IpcRendererEvent` are stripped before user code sees them.

---

## Contributing

```bash
pnpm install       # install deps
pnpm run check     # lint + typecheck
pnpm run lint      # ESLint
pnpm run typecheck # tsc --noEmit
pnpm test          # vitest run
pnpm run build     # tsup
```

All four checks must pass on every pull request (enforced by CI).

---

## GitHub workflows

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | Push and pull request on `main` | Runs static checks (`lint`, `typecheck`), tests (Node 18/20/22), and build artefact verification |
| CodeQL | `.github/workflows/codeql.yml` | Push, pull request on `main`, weekly schedule | Runs GitHub CodeQL with `security-extended` queries for JavaScript/TypeScript |

### CI pipeline layout

1. `check` job: `pnpm run check` (lint + typecheck + type tests).
2. `test` job: `pnpm test` on Node 18, 20, and 22.
3. `build` job: `pnpm run build` and verifies expected files in `dist/`.

The `typecheck` script uses `tsconfig.typecheck.json` and is scoped to library code (`src/`, `tests/`) so example app files do not block package publishing CI.

### Dependabot

Dependabot configuration lives in `.github/dependabot.yml`.

- Weekly updates for npm dependencies.
- Weekly updates for GitHub Actions.
- Groups development dependency updates to reduce PR noise.
- Keeps `electron` pinned for manual review before upgrades.

---

## Local checks

Run these before opening a pull request:

```bash
pnpm run check
pnpm test
pnpm run build
```

---

## Note on impact

In a typical setup with 3 request/response IPC methods and 3 push events,
`electron-ipc-helper` usually removes around 35 lines of IPC boilerplate
and reduces IPC maintenance surface by roughly 70%.
