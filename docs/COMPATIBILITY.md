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
  console.warn('[electron-ipc-helper] oldFunction is deprecated. Use newFunction instead.');
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

## Electron Version Support

| electron-ipc-helper | Electron peer | Node.js minimum |
|---|---|---|
| 0.x | ≥ 20.0.0 | 18 |
| 1.x (planned) | ≥ 28.0.0 | 20 |

Electron follows its own LTS calendar. We track the latest **two** Electron major versions.

---

## TypeScript Support

Minimum TypeScript version: **5.0**.

We do not guarantee compatibility with TypeScript versions older than 5.0. We test against the latest stable TypeScript release.

---

## Node.js Support

Minimum Node.js version: **18 (LTS)**.

We test against all Node.js **Active LTS** and **Current** releases.
