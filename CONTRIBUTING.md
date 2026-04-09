# Contributing to electron-ipc-helper

Thank you for contributing! This document explains how to propose changes, set up your development environment, and ensure your work meets our quality standards.

---

## Table of contents

1. [Code of Conduct](#code-of-conduct)
2. [How to contribute](#how-to-contribute)
3. [Development setup](#development-setup)
4. [Quality gates](#quality-gates)
5. [RFC process](#rfc-process)
6. [Pull request guidelines](#pull-request-guidelines)
7. [Ownership map](#ownership-map)
8. [Review SLAs](#review-slas)

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be respectful. Harassment and abuse will not be tolerated.

---

## How to contribute

| Type | How |
|---|---|
| Bug report | Open a GitHub issue using the bug report template |
| Feature request | Open a GitHub issue with the feature-request template; if significant, file an RFC |
| Minor fix (docs, typo, < 10 lines) | Open a PR directly; no issue required |
| New feature / API change | File an issue or RFC first; wait for maintainer buy-in before implementing |
| Security issue | **Do not open a public issue.** Email the maintainers privately. |

---

## Development setup

**Requirements:** Node.js ≥ 18, pnpm ≥ 10

```bash
# 1. Clone
git clone https://github.com/your-org/electron-ipc-helper.git
cd electron-ipc-helper

# 2. Install
pnpm install

# 3. Build
pnpm run build

# 4. Run tests
pnpm run test

# 5. Run full check (lint + types + tests)
pnpm run check:all:coverage
```

---

## Quality gates

Every PR must pass all of the following before merge:

| Gate | Command | Threshold |
|---|---|---|
| Lint | `pnpm run lint` | 0 errors |
| Type check | `pnpm run typecheck` | 0 errors |
| Type-level tests | `pnpm run test:types` | all pass |
| Unit tests | `pnpm run test` | all pass |
| Coverage | `pnpm run test:coverage` | ≥ 80% lines, branches, functions |
| Build | `pnpm run build` | 0 errors |

Failing any gate blocks the PR from merging.

---

## RFC process

An RFC (Request for Comments) is required for:

- Any change to a **Stable** API surface (see [`CHARTER.md`](./docs/CHARTER.md))
- New modules or entry points
- Changes to the build system, release pipeline, or CI
- Deprecation of any public API

**RFC process:**

1. Open a GitHub Discussion titled `[RFC] Your proposal title`.
2. Use the RFC issue template for structure.
3. Allow at least **7 days** for community feedback.
4. A maintainer marks it `rfc: accepted` or `rfc: rejected`.
5. Only after acceptance: open a PR implementing the RFC.

---

## Pull request guidelines

- Keep PRs focused. One logical change per PR.
- Write or update tests. PRs that reduce coverage are rejected.
- Update `CHANGELOG.md` under `## Unreleased`.
- Reference the issue or RFC in the PR description.
- Rebase on main (no merge commits).
- Ensure CI passes before requesting review.

---

## Ownership map

| Area | Primary reviewer |
|---|---|
| Core IPC (`src/main.ts`, `src/preload.ts`, `src/types.ts`) | @core-maintainer |
| Menus & actions (`src/menus.ts`) | @core-maintainer |
| Lifecycle (`src/lifecycle.ts`) | @core-maintainer |
| Plugin system (`src/plugins.ts`, `src/plugins/`) | @core-maintainer |
| Scaffolding CLI (`packages/create-electron-ipc-app/`) | @dx-maintainer |
| Documentation (`docs/`) | @docs-maintainer |
| CI & release pipeline (`.github/`) | @devops-maintainer |

---

## Review SLAs

| PR type | First-response SLA | Merge SLA |
|---|---|---|
| Bug fix | 2 business days | 5 business days |
| Feature (with RFC) | 3 business days | 10 business days |
| Docs / typo | 2 business days | 3 business days |
| Security fix | 1 business day | 2 business days |

SLAs are targets, not guarantees. Complex changes may take longer.
