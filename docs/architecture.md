# Architecture

A technical overview of how electron-ipc-helper is structured, how data flows between processes, and how the layered model is designed for safe evolution.

---

## Process model

Electron apps run across three distinct JavaScript contexts with hard boundaries:

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                         │
│  - Full OS access                                               │
│  - Registers IPC handlers (ipcMain.handle)                      │
│  - Manages windows, menus, lifecycle                            │
├─────────────────────────────────────────────────────────────────┤
│  Preload Script (Node.js + contextBridge)                       │
│  - Isolated context — executes before renderer                  │
│  - Bridges main ↔ renderer safely via contextBridge             │
│  - Only whitelisted APIs cross the boundary                     │
├─────────────────────────────────────────────────────────────────┤
│  Renderer Process (Chromium, sandboxed)                         │
│  - No direct Node.js access                                     │
│  - Calls window.api.* (bridged by preload)                      │
│  - Subscribes to window.events.* (pushed by main via preload)   │
└─────────────────────────────────────────────────────────────────┘
```

electron-ipc-helper provides the typed glue for each boundary.

---

## Data flow

### Request / Response (IPC invoke)

```
Renderer                  Preload               Main
────────                  ───────               ────
window.api.getUser(id)
  → ipcRenderer.invoke('getUser', id)
                            │
                            └──→ ipcMain.handle('getUser', handler)
                                   └──→ handler(id)
                                          └──→ { id, name }
                            ←──────────────────────────────
  ← Promise<User> ←────────┘
```

### Push Events (ipcRenderer.on)

```
Main                      Preload               Renderer
────                      ───────               ────────
events.emit(win, 'fileChanged', '/doc.txt')
  → win.webContents.send('fileChanged', '/doc.txt')
                            │
                            └──→ ipcRenderer.on('fileChanged', listener)
                                   strips IpcRendererEvent
                                   └──→ callback('/doc.txt')
```

---

## Layered model

The framework is organized in three layers. Inner layers are stable before outer layers are built.

```
Layer 3: Scaffolding + Plugins
  create-electron-ipc-app CLI   PluginHost + reference plugins
         │                              │
Layer 2: Composition / Runtime Glue
  appkit (MainAppKit)    lifecycle (ChildProcessLifecycle)
  menus (buildMenuTemplate, ActionDescriptor)
  integrations (dialog, shell)
         │
Layer 1: Stable Runtime Primitives
  main.ts      defineIpcApi, defineIpcEvents
  preload.ts   exposeApiToRenderer, exposeEventsToRenderer, exposeValues
  types.ts     IpcApi<T>, IpcEvents<T>, RendererApi<T>, RendererEvents<T>
               ExtractRendererApi<T>, ExtractRendererEvents<T>
```

**Rule:** Layer N may only import from Layer N or lower. No circular dependencies.

---

## Type inference chain

The key to zero-annotation usage is the phantom brand on `IpcApi<T>`:

```ts
// 1. Main process — T is inferred from the handler map
const api = defineIpcApi({
  getUser: async (id: string) => ({ id, name: 'Alice' }),
});
// api: IpcApi<{ getUser: (id: string) => Promise<{ id: string; name: string }> }>

// 2. Preload — exposeApiToRenderer reads T from the opaque handle
exposeApiToRenderer(api); // bridges RendererApi<T> via contextBridge

// 3. Renderer — ExtractRendererApi<typeof api> reconstructs the type
type Api = ExtractRendererApi<typeof api>;
// Api: { readonly getUser: (id: string) => Promise<{ id: string; name: string }> }

// 4. window.api is typed via Window augmentation in renderer.d.ts
const user = await window.api.getUser('123');
//    ^? { id: string; name: string }
```

No `as`, no type assertions, no manual annotations.

---

## Module entry points

| Entry point | Process | Key exports |
|---|---|---|
| `electron-ipc-helper` | Main | `defineIpcApi`, `defineIpcEvents`, `ChildProcessLifecycle` |
| `electron-ipc-helper/preload` | Preload | `exposeApiToRenderer`, `exposeEventsToRenderer`, `exposeValues` |
| `electron-ipc-helper/integrations` | Main | `registerDialogHandlers`, `registerShellHandlers` |
| `electron-ipc-helper/menus` | Main | `buildMenuTemplate`, `applyApplicationMenuFromFile`, action factories |
| `electron-ipc-helper/appkit` | Main | `createMainAppKit` |
| `electron-ipc-helper/lifecycle` | Main | `ChildProcessLifecycle` |
| `electron-ipc-helper/plugins` | Main | `PluginHost`, `Plugin`, `PluginConflictError` |
| `electron-ipc-helper/plugins/window-state` | Main | `WindowStatePlugin` |
| `electron-ipc-helper/plugins/diagnostics` | Main | `DiagnosticsPlugin` |
| `electron-ipc-helper/plugins/updater` | Main | `UpdaterPlugin` |

Each entry point compiles to a separate `.mjs`/`.cjs` bundle. Renderer bundles never receive main-process code.

---

## Plugin system

Plugins extend the app via a lifecycle-managed contract. See [ADR-003](./adr/ADR-003-plugin-contract.md) for design rationale.

```
app.whenReady()
      │
      ▼
PluginHost.init()   — init all plugins (registration order)
      │
      ▼
PluginHost.start()  — start all plugins (registration order)
      │
      ▼
   [running]
      │
app.before-quit
      │
      ▼
PluginHost.stop()   — stop all plugins (reverse order)
      │
      ▼
PluginHost.dispose()— dispose all plugins (reverse order)
```

---

## Security model

- `ipcRenderer` is **never** exposed to the renderer.
- Only channels declared in `IpcApi._channels` can be invoked.
- Only channels declared in `IpcEvents._channels` can be subscribed.
- `exposeValues` exposes only plain serialisable objects.
- All code assumes `contextIsolation: true` and `sandbox: true`.

See the [Security guide](./security.md) for a full hardening checklist.
