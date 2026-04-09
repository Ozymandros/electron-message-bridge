# Long-Term Support (LTS) Policy

**Version:** 1.0

---

## Overview

Selected major releases of electron-ipc-helper receive Long-Term Support (LTS). LTS releases are maintained with security patches and critical bug fixes for an extended window, giving production users a stable upgrade path.

---

## LTS Schedule

| Version | Status | Released | Active LTS ends | Maintenance ends |
|---|---|---|---|---|
| 0.x | Current (pre-stable) | 2026-04-08 | On 1.0 release | On 1.0 + 6 months |
| 1.x | Planned | TBD | TBD + 12 months | TBD + 18 months |

---

## LTS Maintenance Rules

LTS branches receive:

- **Security patches** — applied within 7 days of a CVE being confirmed.
- **Critical bug fixes** — P0 bugs (data loss, crashes, security) are backported.
- **Dependency updates** for security-relevant packages only.

LTS branches do **not** receive:

- New features.
- Non-critical bug fixes.
- Performance improvements.
- API additions.

---

## Version Designation

A major version is designated LTS at the time of its `.0` release. The designation is announced in the release notes and CHANGELOG.

---

## End-of-Life

When a version reaches its Maintenance end date:

1. A final announcement is published.
2. No further patches are applied.
3. The branch is archived but the npm version remains published.
4. Users are advised to upgrade to the current LTS or latest release.

---

## Migration commitment

For each LTS → next-LTS migration, we publish:

- A migration guide in `docs/migration.md`.
- A compatibility shim package (`electron-ipc-helper-compat`) if breaking changes are significant.
- A minimum 3-month overlap window where both versions are actively maintained.
