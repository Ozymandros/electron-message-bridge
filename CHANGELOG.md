# Changelog

All notable changes to `electron-ipc-helper` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Plugin architecture (`src/plugins.ts`): `PluginHost`, `Plugin<Caps>`, `PluginContext`, `PluginConflictError`, `PluginHook` — lifecycle-managed, typed capability plugins with conflict detection and error isolation.
- Reference plugins: `WindowStatePlugin` (window bounds persistence), `DiagnosticsPlugin` (IPC call counting, snapshots), `UpdaterPlugin` (auto-updater facade).
- New entry points: `electron-ipc-helper/plugins`, `electron-ipc-helper/plugins/window-state`, `electron-ipc-helper/plugins/diagnostics`, `electron-ipc-helper/plugins/updater`.
- Scaffolding CLI package: `create-electron-ipc-app` — `minimal` and `full` templates, non-interactive mode.
- API surface snapshot tests (`tests/api-surface.test.ts`) — guards against accidental breaking changes.
- Chaos lifecycle tests (`tests/lifecycle-chaos.test.ts`) — rapid crash/restart, concurrent start/stop, flaky readyCheck scenarios.
- Benchmark suite (`benchmarks/ipc.bench.ts`) — IPC throughput, handler registration, PluginHost overhead.
- Documentation system: `docs/quickstart.md`, `docs/architecture.md`, `docs/patterns.md`, `docs/security.md`, `docs/performance.md`, `docs/migration.md`, `docs/troubleshooting.md`.
- Governance documentation: `docs/CHARTER.md`, `docs/COMPATIBILITY.md`, `docs/adr/` (ADR-001, ADR-002, ADR-003), `docs/governance/` (maturity model, LTS policy).
- `CONTRIBUTING.md` — RFC process, ownership map, review SLAs.
- GitHub issue templates: bug report and RFC (``.github/ISSUE_TEMPLATE/``).
- CI hardening: coverage enforcement (≥80%), dependency audit job, API surface regression job, dist artifact size budget gate, plugin dist verification.

---

## [0.1.0] — 2026-04-08

### Added
- `defineIpcApi(handlers)` — registers `ipcMain.handle` for each handler, returns an `IpcApi<T>` opaque handle with `dispose()`.
- `defineIpcEvents(schema)` — returns an `IpcEvents<T>` handle with a typed `emit(target, channel, ...args)` method.
- `exposeApiToRenderer(api, key?)` — bridges `IpcApi<T>` to the renderer via `contextBridge`. Defaults to `window.api`.
- `exposeEventsToRenderer(events, key?)` — bridges `IpcEvents<T>` subscriptions to the renderer. Each subscription returns an unsubscribe function.
- `exposeValues(values, key)` — exposes a plain serialisable object to the renderer via `contextBridge`.
- `registerDialogHandlers(prefix?)` — registers `dialog:open-file`, `dialog:open-directory`, `dialog:save-file`, `dialog:message-box` IPC handlers.
- `registerShellHandlers(prefix?)` — registers `shell:open-external`, `shell:open-path` IPC handlers.
- `exposeDialogsToRenderer(key?, prefix?)`, `exposeShellToRenderer(key?, prefix?)` — preload-side bridges for dialog/shell.
- `buildMenuTemplate(items, options?)` — converts declarative menu items to Electron menu templates with typed action resolution.
- `loadMenuSpecFromFile(filePath, options?)` — loads a JSON/YAML menu spec from disk with validation.
- `applyApplicationMenuFromFile(filePath, options?)` — loads, builds, and sets the application menu.
- `commandAction(fn)`, `serviceAction(fn)`, `emitAction(fn)` — typed `ActionDescriptor` factory helpers.
- `ChildProcessLifecycle` — spawn, supervise, restart, and stop child processes with typed lifecycle events (`ready`, `crashed`, `failed`), `readyCheck`, `autoRestart`, `maxRestarts`, force-kill timeout.
- `createMainAppKit(options)` — opinionated app bootstrap helper for menu, lifecycle, and event wiring.
- `ExtractRendererApi<T>`, `ExtractRendererEvents<T>` — utility types for `Window` augmentation.
- Dual ESM/CJS build with `.mjs`/`.cjs` extensions via tsup.
- Full TypeScript phantom-brand end-to-end type inference — no manual annotations required.
- 91 unit tests across 9 suites, ≥80% coverage.
- GitHub Actions CI: lint, typecheck, tests (Node 18/20/22 matrix), build verification, CodeQL, release with npm provenance.

---

[Unreleased]: https://github.com/your-org/electron-ipc-helper/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/electron-ipc-helper/releases/tag/v0.1.0
