# Typical Electron Migration Playbook

An opinionated, step-by-step migration runbook for moving from manual Electron IPC wiring to `electron-message-bridge` with minimal risk.

Use this when you want a predictable rollout that an AI coding assistant can execute in small, verifiable phases.

---

## Scope and goals

This playbook targets existing Electron apps that currently use any of:

- `ipcMain.handle` + `ipcRenderer.invoke`
- `webContents.send` + `ipcRenderer.on`
- manual `contextBridge.exposeInMainWorld`

Primary goals:

- Reduce repeated IPC boilerplate.
- Preserve runtime behavior while improving type safety.
- Migrate in reversible phases with clear acceptance checks.

Non-goals:

- Rewriting business logic.
- Changing app architecture in one shot.
- Introducing plugins/menus/lifecycle features unless explicitly needed.

---

## When to use this migration

Use this migration when one or more are true:

- You maintain 3+ invoke handlers or 2+ push event channels.
- Renderer code has repeated channel strings.
- You need stronger TypeScript guarantees across main/preload/renderer.
- You are supporting both desktop shell and web mode with a transport boundary.

Skip or defer this migration when all are true:

- App is small and Electron-only.
- Existing IPC wiring is stable and low-change.
- You do not need stronger typing right now.

---

## Phase 0 - Audit and map (no behavior changes)

### Objective

Create an inventory of existing IPC surfaces before touching code.

### Actions

1. List request/response channels (`ipcMain.handle`, `ipcRenderer.invoke`).
2. List push channels (`webContents.send`, `ipcRenderer.on`).
3. List current preload exposures (`contextBridge.exposeInMainWorld`).
4. Build a mapping table:
   - old channel name
   - new typed method/event name
   - request payload type
   - response payload type
   - owner module

### Acceptance checks

- Every live channel is accounted for.
- No migration coding starts without a complete mapping table.

### Rollback

Not needed. No runtime changes yet.

---

## Phase 1 - Request/response migration only

### Objective

Move invoke handlers to typed API definitions without touching push events yet.

### Actions

1. Create `api.ts` in the main-process area.
2. Move handler functions into `defineIpcApi({ ... })`.
3. In preload, switch to `exposeApiToRenderer(api)` from `electron-message-bridge/preload`.
4. Add renderer type augmentation using `ExtractRendererApi<typeof api>`.
5. Keep old channel aliases temporarily if external callers still depend on them.

### Minimal diff strategy

- Keep existing business functions unchanged.
- Only replace IPC registration and preload bridging.
- Do not mix push-event migration into this phase.

### Acceptance checks

- All migrated request methods return identical payloads.
- Error behavior matches previous behavior.
- Renderer compiles with typed API access.
- No direct `ipcRenderer.invoke('channel')` remains for migrated methods.

### Rollback

Re-enable previous `ipcMain.handle` registrations and preload exposure for affected methods.

---

## Phase 2 - Push events migration

### Objective

Replace manual send/on event wiring with typed event descriptors.

### Actions

1. Create `events.ts` with `defineIpcEvents({ ... })`.
2. Replace direct `webContents.send('channel', ...)` with `events.emit(win, 'eventName', ...)`.
3. In preload, expose `exposeEventsToRenderer(events)`.
4. Update renderer subscriptions to `window.events.eventName(callback)`.
5. Ensure all subscriptions use returned unsubscribe callbacks.

### Minimal diff strategy

- Keep old event payload shapes unchanged.
- Do not rename every event immediately unless needed.

### Acceptance checks

- Renderer receives all migrated events.
- Unsubscribe works and prevents duplicate callbacks.
- No leaked listeners during navigation/reload.

### Rollback

Temporarily restore manual `ipcRenderer.on` bridges for specific channels.

---

## Phase 3 - Remove dead wiring

### Objective

Delete deprecated manual IPC code only after parity is proven.

### Actions

1. Remove now-unused `ipcMain.handle` channel strings.
2. Remove now-unused preload wrappers built around `ipcRenderer`.
3. Remove renderer call sites that use literal channel names.
4. Keep compatibility shims only where external integrations still require them.

### Acceptance checks

- No references to removed channels remain.
- Tests pass with only typed APIs/events.
- Dev hot reload does not duplicate handlers.

### Rollback

Restore removed wrappers for the specific channel that regressed.

---

## Phase 4 - Optional enhancements

Only after phases 1 to 3 are stable.

Optional items:

- `api.dispose()` for HMR-safe handler replacement.
- `exposeValues` for static metadata (`platform`, `version`, flags).
- `menus` action descriptors to replace ad-hoc menu dispatch.
- `plugins` for lifecycle-managed startup/shutdown concerns.

---

## Test matrix per phase

Run this matrix after each phase, not only at the end.

1. Type checks:
   - renderer global augmentation compiles
   - API/event signatures infer as expected
2. Runtime happy paths:
   - at least one migrated request call succeeds
   - at least one migrated push event is received
3. Runtime error paths:
   - one request failure maps to expected UI behavior
4. Lifecycle checks:
   - window reload does not duplicate listeners
   - app restart path still initializes preload correctly

---

## Claude execution prompt template

Use this prompt in a dependent app to keep migrations controlled and incremental:

```text
You are migrating an existing Electron app from manual IPC wiring to electron-message-bridge.

Rules:
1) Do the migration in phases. Stop after each phase and summarize file-by-file diffs.
2) Phase 0: audit all ipcMain.handle, ipcRenderer.invoke, webContents.send, ipcRenderer.on, and contextBridge.exposeInMainWorld usage.
3) Produce a mapping table old channel -> new typed method/event with payload/response types.
4) Phase 1 only: migrate request/response handlers to defineIpcApi + exposeApiToRenderer.
5) Add renderer type augmentation using ExtractRendererApi.
6) Keep temporary compatibility aliases for old channels if needed.
7) Add or update tests for one success and one failure path per migrated method.
8) Wait for approval before Phase 2.
9) Phase 2: migrate push events to defineIpcEvents + exposeEventsToRenderer with unsubscribe semantics.
10) Phase 3: remove dead manual IPC code only after tests pass.

Constraints:
- Preserve runtime behavior and payload shapes.
- Do not refactor unrelated business logic.
- Keep commits small and reversible.
```

---

## Common pitfalls and fixes

1. Pitfall: Mixing request and event migration in one large PR.
   Fix: Keep phases separate to simplify verification and rollback.

2. Pitfall: Removing old channels before all callers migrate.
   Fix: Keep short-lived aliases and remove in a cleanup phase.

3. Pitfall: Missing renderer type augmentation.
   Fix: Add `Window` declaration updates in the same PR as preload changes.

4. Pitfall: Event listener leaks.
   Fix: Always store and call unsubscribe functions on teardown.

5. Pitfall: HMR duplicate handler errors.
   Fix: Use `api.dispose()` in hot-reload flows.

---

## Migration completion checklist

- [ ] All request channels migrated to `defineIpcApi`.
- [ ] All push channels migrated to `defineIpcEvents`.
- [ ] Preload uses `electron-message-bridge/preload` only.
- [ ] Renderer uses typed `window` augmentation.
- [ ] Dead manual IPC wiring removed.
- [ ] Test matrix passes.
- [ ] Team docs updated with new entry points and patterns.
