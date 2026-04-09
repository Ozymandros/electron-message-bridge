# Launch Checklist — Framework Preview

This checklist must be completed before promoting the framework from `0.x` (pre-stable) to a stable `1.0` release.

---

## Quality gates

- [ ] All CI checks green on `main` for 5 consecutive days.
- [ ] Test coverage ≥ 80% on lines, branches, and functions.
- [ ] Zero open P0 bugs.
- [ ] Zero CodeQL alerts (security-extended query suite).
- [ ] `pnpm audit --audit-level high` passes with no findings.
- [ ] All benchmarks within budget (see `benchmarks/ipc.bench.ts`).

## API stabilization

- [ ] All **Stable**-labelled APIs are marked in `CHARTER.md` and have full JSDoc.
- [ ] All **Beta**-labelled APIs have `@beta` JSDoc tags and migration notes.
- [ ] All **Experimental**-labelled APIs have `@experimental` JSDoc tags.
- [ ] `ExtractRendererApi<T>` and `ExtractRendererEvents<T>` inference verified against the type tests in `tests/types.test-d.ts`.
- [ ] `IpcApi.dispose()` tested for idempotency.
- [ ] API surface snapshot tests (`tests/api-surface.test.ts`) are up to date and passing.

## Documentation

- [ ] `docs/quickstart.md` — reviewed and tested against a fresh scaffold.
- [ ] `docs/architecture.md` — accurate diagrams and entry-point table.
- [ ] `docs/patterns.md` — all 8 patterns verified against current API.
- [ ] `docs/security.md` — reviewed by security-focused maintainer.
- [ ] `docs/performance.md` — budget numbers verified against benchmark output.
- [ ] `docs/migration.md` — manual/IPC → library migration guide tested.
- [ ] `docs/troubleshooting.md` — all error messages match current runtime output.
- [ ] `README.md` — installation, quickstart, and entry-point table up to date.
- [ ] `CHANGELOG.md` — all 0.x changes documented.

## Plugin system

- [ ] `PluginHost` conflict detection tested with all 3 reference plugins installed together.
- [ ] `WindowStatePlugin` tested on macOS, Windows, and Linux.
- [ ] `DiagnosticsPlugin` `logIntervalMs` timer verified to `unref()` correctly.
- [ ] `UpdaterPlugin` tested with a mock engine implementing `checkForUpdatesAndNotify`.

## Scaffolding CLI

- [ ] `create-electron-ipc-app my-app --template minimal` produces a project that:
  - [ ] `npm install` succeeds.
  - [ ] `npm run build` succeeds.
  - [ ] `npm test` passes.
- [ ] `create-electron-ipc-app my-app --template full` produces a project that:
  - [ ] `npm install` succeeds.
  - [ ] `npm run build` succeeds.
  - [ ] `npm test` passes.
- [ ] `--yes` non-interactive mode works in CI.

## Release readiness

- [ ] `package.json` version bumped to `1.0.0`.
- [ ] `CHANGELOG.md` has a `## [1.0.0]` entry with full release notes.
- [ ] Git tag `v1.0.0` created on the release commit.
- [ ] `pnpm publish --provenance --dry-run` completes without errors.
- [ ] npm provenance attestation verified after actual publish.
- [ ] GitHub Release created with CHANGELOG excerpt as release notes.
- [ ] Dependabot alerts reviewed and resolved.

## Governance

- [ ] `CONTRIBUTING.md` reviewed and accurate.
- [ ] `docs/COMPATIBILITY.md` versioning table updated for 1.0.
- [ ] `docs/governance/maturity-model.md` updated with promotion dates.
- [ ] `docs/governance/lts-policy.md` updated with 1.0 LTS dates.
- [ ] Issue templates tested by opening a draft issue for each template.

## Post-launch

- [ ] Announce in relevant communities (Electron Discord, GitHub Discussions).
- [ ] Monitor for new issues for 2 weeks post-launch.
- [ ] Schedule first patch release review for 4 weeks post-launch.
