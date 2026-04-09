# Framework Maturity Model

**Version:** 1.0

---

## Overview

The electron-ipc-helper maturity model describes the progression from experimental feature to long-term stable support. Each module and the framework as a whole moves through these stages:

```
Experimental → Beta → Stable → LTS
```

---

## Stage Definitions

### Experimental

- The API may change at any time without deprecation notice.
- Not recommended for production use outside of internal tooling or pilot projects.
- Bugs are expected; coverage targets may be lower.
- Feedback from early adopters is actively solicited.
- Marked with `@experimental` in JSDoc.

### Beta

- The API is mostly stable. Breaking changes are allowed in MINOR versions with migration notes.
- Suitable for production use with the understanding that minor breaking changes can occur.
- Test coverage ≥ 80%.
- Migration notes are required in CHANGELOG.md.
- Marked with `@beta` in JSDoc.

### Stable

- The API is frozen. Breaking changes require a MAJOR version bump and a two-version deprecation window.
- Production-ready.
- Test coverage ≥ 80%.
- Full documentation required.
- Performance and security targets are enforced in CI.

### Long-Term Support (LTS)

- Selected Stable releases are designated LTS.
- LTS releases receive security patches and critical bug fixes for 18 months.
- No new features are added to LTS branches.
- LTS release schedule: one per major version, designated at release.

---

## Current Module Maturity

| Module | Stage | Since |
|---|---|---|
| `defineIpcApi` / `defineIpcEvents` | Stable | 0.1.0 |
| `exposeApiToRenderer` / `exposeEventsToRenderer` / `exposeValues` | Stable | 0.1.0 |
| `registerDialogHandlers` / `registerShellHandlers` | Stable | 0.1.0 |
| `buildMenuTemplate` / `applyApplicationMenuFromFile` | Stable | 0.1.0 |
| `ActionDescriptor` / `ActionRegistry` | Stable | 0.1.0 |
| `ChildProcessLifecycle` | Beta | 0.1.0 |
| `createMainAppKit` (appkit) | Beta | 0.1.0 |
| `PluginHost` / `Plugin` | Experimental | 0.1.0 |
| Reference plugins (window-state, diagnostics, updater) | Experimental | 0.1.0 |
| `create-electron-ipc-app` CLI | Experimental | 0.1.0 |

---

## Promotion Criteria

### Experimental → Beta

- [ ] All public API surfaces are documented with JSDoc.
- [ ] Test coverage ≥ 80%.
- [ ] At least one known production use case validated.
- [ ] No open P0 bugs.

### Beta → Stable

- [ ] API has been stable for at least two minor releases.
- [ ] Full documentation (quickstart, examples, API reference, migration notes).
- [ ] Test coverage ≥ 80% with no unchecked regressions.
- [ ] Performance benchmarks meet CI budgets.
- [ ] Security review completed.
- [ ] RFC accepted (if API changes were made during Beta).

### Stable → LTS

- [ ] MAJOR version released.
- [ ] All Stable APIs are covered by the compatibility policy.
- [ ] Maintainer team commits to LTS support window.
