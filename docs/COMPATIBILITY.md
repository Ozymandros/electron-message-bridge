# Compatibility and Versioning Policy

**Version:** 1.0  
**Status:** Active

---

## Semantic Versioning

This library follows [Semantic Versioning 2.0](https://semver.org/):

| Version segment | Meaning |
|---|---|
| **MAJOR** (`x.0.0`) | Breaking changes to any **Stable** public API |
| **MINOR** (`0.x.0`) | New backward-compatible features or new **Experimental** APIs |
| **PATCH** (`0.0.x`) | Bug fixes, performance improvements, documentation updates |

---

## Stability Labels

Each module surface carries an explicit stability label:

| Label | Contract |
|---|---|
| **Stable** | Public API is frozen. Changes require a MAJOR bump with full deprecation window. |
| **Beta** | API is mostly settled. Breaking changes allowed in MINOR bumps with migration notes. |
| **Experimental** | API may change at any time. Use with caution outside internal tooling. |

Current stability assignments are in [`CHARTER.md`](./CHARTER.md).

---

## Deprecation Process

1. The deprecated API is annotated with `@deprecated` JSDoc and emits a runtime `console.warn` (in development builds).
2. The deprecated API is documented in `CHANGELOG.md` under a `### Deprecated` section.
3. The deprecated API remains fully functional for **two minor versions** after the deprecation announcement.
4. Removal ships in the next **MAJOR** version after the two-version window expires.

```ts
/**
 * @deprecated Use `newFunction` instead. Will be removed in v2.0.
 */
export function oldFunction() {
  console.warn('[electron-message-bridge] oldFunction is deprecated. Use newFunction instead.');
  return newFunction();
}
```

---

## Breaking Change Policy

A **breaking change** is any change that:

- Removes or renames a public exported symbol.
- Changes function signatures in a backward-incompatible way.
- Changes the runtime behavior of an existing API in an observable way.
- Adds a required parameter to an existing exported function.
- Changes TypeScript type definitions in a way that breaks existing code at compile time.

The following are **not** breaking changes:

- Adding new optional parameters with defaults.
- Adding new exports.
- Adding new optional fields to option objects.
- Internal refactors with identical external behavior.
- Performance improvements.
- Documentation updates.

---

## Version Support Matrix

### Core Package (`electron-message-bridge`)

| electron-message-bridge | Electron | Node.js | TypeScript | Status |
|---|---|---|---|---|
| **0.x** (current) | ≥ 20.0 | ≥ 18 LTS | ≥ 5.0 | Active |
| **1.x** (planned) | ≥ 28.0 | ≥ 20 LTS | ≥ 5.4 | Planned |

### Adapter: `electron-message-bridge-adapter-assemblyscript`

| adapter version | core peer | Node.js | AssemblyScript | AS Loader | Status |
|---|---|---|---|---|---|
| **0.3.x** (current) | `>=0.1.0` | ≥ 18 | ≥ 0.27 | ≥ 0.10 (optional) | Active |
| **0.4.x** (planned) | `>=0.2.0` | ≥ 18 | ≥ 0.27 | ≥ 0.10 (optional) | Planned |

### Electron LTS Coverage

Electron follows Chromium's release cadence. We track the **two most recent major Electron versions** with active Chromium support.

| Electron | Chromium | Node.js (bundled) | Tested | electron-message-bridge 0.x |
|---|---|---|---|---|
| 20.x | 104 | 16.15 | No (EOL) | ✗ |
| 28.x | 120 | 18.18 | ✓ | ✓ |
| 29.x | 122 | 20.9 | ✓ | ✓ |
| 30.x | 124 | 20.14 | ✓ | ✓ |
| 31.x | 126 | 20.15 | ✓ | ✓ |
| 32.x | 128 | 20.16 | ✓ | ✓ |
| 33.x | 130 | 20.18 | ✓ | ✓ |
| 34.x | 132 | 22.12 | ✓ | ✓ |

> **Note:** Electron versions older than 20 used APIs (`contextBridge`, `ipcMain.handle`) that predate the stable patterns this library relies on. They are not supported.

### Node.js LTS Coverage

| Node.js | Status | electron-message-bridge 0.x |
|---|---|---|
| 16.x | EOL | ✗ |
| 18.x | Maintenance LTS | ✓ |
| 20.x | Active LTS | ✓ |
| 22.x | Active LTS | ✓ |
| 23.x | Current | ✓ |

We test against all Node.js **Active LTS** and **Current** releases in CI. End-of-life Node.js versions are not supported.

### TypeScript Compatibility

| TypeScript | electron-message-bridge 0.x | Notes |
|---|---|---|
| < 4.9 | ✗ | Missing `satisfies` operator |
| 4.9.x | ✗ | Missing `exactOptionalPropertyTypes` correctness |
| 5.0.x | ✓ | Minimum supported version |
| 5.1.x | ✓ | |
| 5.2.x | ✓ | |
| 5.3.x | ✓ | |
| 5.4.x | ✓ | |
| 5.5.x | ✓ | |
| Latest stable | ✓ | Always tested in CI |

The package ships with `"strict": true`, `"exactOptionalPropertyTypes": true`, and `"noUncheckedIndexedAccess": true` in its own build. Consumers with less strict configs are supported — our type exports are valid under all standard strict settings.

---

## Electron Version Support

Electron follows its own LTS calendar. We track the latest **two** Electron major versions. A release of `electron-message-bridge` specifies the minimum Electron version as a `peerDependency`; consuming projects that pin older Electron versions may still work but are not officially tested.

---

## TypeScript Support

Minimum TypeScript version: **5.0**.

We do not guarantee compatibility with TypeScript versions older than 5.0. We test against the latest stable TypeScript release and all minor versions in the 5.x series.

---

## Node.js Support

Minimum Node.js version: **18 (LTS)**.

We test against all Node.js **Active LTS** and **Current** releases in CI.

---

### Adapter: `@electron-ipc-helper/adapter-grpc`

| adapter version | core peer | Node.js | Notes | Status |
|---|---|---|---|---|
| **0.1.x** (current) | `>=0.1.0` | ≥ 18 | Requires `@grpc/grpc-js` as a peer dependency. Exposes `BridgeServiceDefinition` compatible with `@grpc/grpc-js`. | Active |

Installation:

```bash
pnpm add @electron-ipc-helper/adapter-grpc @grpc/grpc-js
```

### Adapter: `@electron-ipc-helper/adapter-named-pipe`

| adapter version | core peer | Node.js | Notes | Status |
|---|---|---|---|---|
| **0.1.x** (current) | `>=0.1.0` | ≥ 18 | Exposes Named Pipe / Unix socket transport for inter-process RPC. Supports binary payloads where applicable. | Active |

Installation:

```bash
pnpm add @electron-ipc-helper/adapter-named-pipe
```

### Adapter: `@electron-ipc-helper/adapter-stdio`

| adapter version | core peer | Node.js | Notes | Status |
|---|---|---|---|---|
| **0.1.x** (current) | `>=0.1.0` | ≥ 18 | Provides a newline-delimited JSON (NDJSON) stdio transport for CLI and child-process integration. | Active |

Installation:

```bash
pnpm add @electron-ipc-helper/adapter-stdio
```
