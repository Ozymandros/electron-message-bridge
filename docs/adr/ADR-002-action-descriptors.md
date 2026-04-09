# ADR-002: Typed Action Descriptor Pattern for Menus

**Status:** Accepted  
**Date:** 2026-04-08  
**Deciders:** Core maintainers

---

## Context

Declarative menus (JSON/YAML) need to trigger behavior when menu items are clicked. Early designs considered:

1. **Implicit string matching** — if `actionId` matches an IPC channel name, invoke it; otherwise look up in a `commands` map.
2. **Pure callback registry** — `{ [actionId]: () => void }` flat map.
3. **Typed descriptor registry** — `{ [actionId]: ActionDescriptor }` where each descriptor has an explicit `kind`.

The first option creates invisible coupling between the declarative menu spec and IPC channel names. Renaming a channel silently breaks all menus referencing it. It also violates the principle that menu clicks should never call `ipcMain.handle` channels directly (see anti-pattern warning in `menus.ts`).

The second option loses type information about *how* an action is dispatched, making it impossible to enforce the "service function" pattern at the type level.

---

## Decision

Use a **discriminated union** `ActionDescriptor` with three `kind` values:

```ts
type ActionDescriptor =
  | { kind: 'command'; run: () => void | Promise<void> }
  | { kind: 'service'; call: () => void | Promise<void> }
  | { kind: 'emit';    emit: () => void }
```

- `'command'` — direct local logic (open dialog, update state).
- `'service'` — shared service function also used by IPC handlers (enforces DRY architecture).
- `'emit'` — push a typed IPC event to the renderer (pre-bound closure avoids threading `BrowserWindow` through the registry).

The `kind` field makes the routing decision **visible, type-checked, and exhaustively switchable**.

The legacy `commands: Record<string, () => void>` map is preserved as a backward-compatible fallback with lower priority than `actions`.

---

## Resolution order

When a menu item with `actionId` is clicked:

1. `onAction` hook fires (always, for logging/analytics).
2. `actions[actionId]` is resolved via `resolveDescriptor` (exhaustive switch on `kind`).
3. `commands[actionId]` is called (legacy fallback).
4. `console.warn` if a registry is present but the `actionId` is missing.

---

## Consequences

**Positive:**
- No naming collisions between IPC channels and menu action IDs.
- `resolveDescriptor` uses an exhaustive switch — new `kind` values cause a TypeScript compile error if the switch is not updated.
- Pre-bound `emit` closure avoids window-reference threading in the registry type system.
- Backward compatible with existing `commands` usage.

**Negative:**
- Slightly more verbose than a plain callback map.
- Users must learn three descriptor kinds.

**Mitigations:**
- `commandAction(fn)`, `serviceAction(fn)`, `emitAction(fn)` factory helpers reduce boilerplate.
- JSDoc examples on each descriptor interface explain when to use each kind.
