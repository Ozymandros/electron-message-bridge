# ADR-003: Plugin System Contract

**Status:** Accepted  
**Date:** 2026-04-08  
**Deciders:** Core maintainers

---

## Context

As the library grows into a framework, users want to package reusable behaviors (window state persistence, diagnostics, auto-update facades) as installable units that integrate cleanly with the app lifecycle. Without a plugin system, these features are copied across projects or wrapped in ad-hoc patterns.

Requirements:
- Plugins must declare their name and optional capabilities.
- Plugins hook into a lifecycle: `init → start → stop → dispose`.
- Plugins must not conflict (no two plugins register the same capability).
- Plugin ordering must be deterministic.
- Plugin errors must be isolated — one plugin failing must not crash the whole host.

---

## Decision

Define a `Plugin` interface with four optional lifecycle hooks and a `capabilities` record:

```ts
interface Plugin<Caps extends Record<string, unknown> = {}> {
  readonly name: string;
  readonly version?: string;
  readonly capabilities?: Caps;
  init?(context: PluginContext): void | Promise<void>;
  start?(context: PluginContext): void | Promise<void>;
  stop?(context: PluginContext): void | Promise<void>;
  dispose?(context: PluginContext): void | Promise<void>;
}
```

A `PluginHost` class manages registration, lifecycle orchestration, and conflict detection:

- **Registration** (`host.register(plugin)`) validates that no two plugins declare the same capability key.
- **Lifecycle** methods (`init`, `start`, `stop`, `dispose`) call each plugin's corresponding hook in registration order. `stop`/`dispose` run in reverse order (last-registered, first-stopped).
- **Error isolation** — individual plugin errors are caught and logged; they do not stop other plugins.
- **Context injection** — each plugin receives a `PluginContext` with its name and a scoped logger.

---

## Capability Conflict Detection

If two plugins declare a capability with the same key, `PluginHost.register` throws synchronously with a descriptive error:

```
PluginConflictError: Plugin "updater-v2" declares capability "updater" which is already
registered by plugin "updater-v1". Remove one of the conflicting plugins.
```

---

## Reference Plugins

Three reference plugins ship in `src/plugins/`:

| Plugin | Capability key | Description |
|---|---|---|
| `WindowStatePlugin` | `windowState` | Persists and restores window bounds across launches |
| `DiagnosticsPlugin` | `diagnostics` | Logs IPC event counts, process info, and crash info |
| `UpdaterPlugin` | `updater` | Facade for `electron-updater` or compatible update engines |

---

## Consequences

**Positive:**
- Reusable behaviors are encapsulated in self-contained, testable units.
- Conflict detection at registration time prevents subtle runtime bugs.
- Reverse-order teardown mirrors common DI container patterns — plugins that depend on others are stopped before their dependencies.

**Negative:**
- Plugin system adds API surface that must be maintained.
- Error isolation means plugin failures are silent unless the logger is checked.

**Mitigations:**
- `PluginContext.logger` is always provided; plugins should use it for diagnostics.
- `PluginHost` exposes an `onError` callback for global plugin error observability.
