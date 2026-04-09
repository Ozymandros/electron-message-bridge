# electron-ipc-helper Framework Charter

**Version:** 1.0  
**Status:** Active  
**Date:** 2026-04-08

---

## 1. Mission

`electron-ipc-helper` exists to eliminate the repetitive, error-prone boilerplate of Electron's IPC system. It provides a **typed, zero-boilerplate, safe-by-default** bridge between the main process, preload scripts, and renderer processes — and grows into a framework-grade platform for building production Electron applications.

---

## 2. Scope Boundaries

### Included

| Area | Specifics |
|---|---|
| IPC contracts | `defineIpcApi`, `defineIpcEvents`, typed handles, phantom brands |
| Preload bridge | `exposeApiToRenderer`, `exposeEventsToRenderer`, `exposeValues` |
| Menus & actions | Declarative JSON/YAML menus, typed `ActionDescriptor` registry |
| Lifecycle utilities | `ChildProcessLifecycle` — spawn, restart, stop, crash recovery |
| Built-in integrations | Dialog and shell IPC helpers |
| App composition | `appkit` — opinionated app bootstrap helper |
| Plugin system | `PluginHost` — lifecycle-managed, typed capability plugins |
| Scaffolding CLI | `create-electron-ipc-app` — project templates, strict defaults |

### Excluded

| Area | Reason |
|---|---|
| Renderer UI framework | Framework-agnostic. Works with React, Vue, Svelte, vanilla. |
| App-specific backend protocols | Users own business logic above the IPC contract layer |
| Bundler/packager integration | `electron-builder`, `electron-forge` are out-of-scope peers |
| Auto-updater implementation | An updater *facade* plugin is in scope; the updater engine is not |
| Renderer-to-renderer IPC | Not a Electron pattern this library endorses |

---

## 3. Design Principles

1. **Typed end-to-end.** Types flow automatically from `defineIpcApi` → `exposeApiToRenderer` → `window.api`. No manual annotation required.
2. **Safe by default.** Works with `contextIsolation: true` and `sandbox: true`. Never exposes `ipcRenderer` or arbitrary channel names to the renderer.
3. **Zero boilerplate.** Users never write `ipcMain.handle`, `ipcRenderer.invoke`, or `contextBridge.exposeInMainWorld` directly.
4. **Minimal API surface.** A small, stable, intuitive public API. Internals can evolve; the public surface cannot change without a deprecation window.
5. **Layered architecture.** Layer 1 (runtime primitives) is stable before Layer 2 (composition) is stabilized, which is stable before Layer 3 (scaffolding/plugins).
6. **Additive-first.** New capabilities are added without removing or changing existing ones. Removal requires a deprecation window per the compatibility policy.

---

## 4. Success Metrics Baseline

| Metric | Target | Measurement |
|---|---|---|
| Setup time to first running app | < 5 minutes | Scaffolded project smoke test timer |
| CI pass rate | ≥ 99% on main | GitHub Actions history |
| CI duration | < 3 minutes | Workflow `duration` metric |
| IPC invoke p95 latency | < 2 ms (in-process benchmark) | `benchmarks/ipc.bench.ts` |
| Cold start overhead | < 50 ms added over bare Electron | `benchmarks/startup.bench.ts` |
| Test coverage | ≥ 80% lines, branches, functions | Vitest v8 coverage report |
| Defect escape rate | 0 P0 bugs in stable releases | GitHub release issue tracker |

---

## 5. Module Ownership

| Module | File | Stability |
|---|---|---|
| Core IPC | `src/main.ts`, `src/preload.ts`, `src/types.ts` | **Stable** |
| Events | `src/main.ts` (`defineIpcEvents`) | **Stable** |
| Integrations | `src/integrations.ts` | **Stable** |
| Menus & Actions | `src/menus.ts` | **Stable** |
| App composition | `src/appkit.ts` | **Beta** |
| Lifecycle | `src/lifecycle.ts` | **Beta** |
| Plugin system | `src/plugins.ts` | **Experimental** |
| Scaffolding CLI | `packages/create-electron-ipc-app` | **Experimental** |

---

## 6. Governance

- RFC process required for changes that affect any **Stable** module's public surface.
- ADRs (Architecture Decision Records) required for any cross-cutting design choice.
- Deprecation window: **two minor versions** before removal of any public API.
- All PRs to `main` require at least one reviewer approval.
- Security issues are reported privately to maintainers before public disclosure.

---

## 7. License

MIT. See `LICENSE`.
