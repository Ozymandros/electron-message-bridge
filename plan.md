## Plan: Electron Framework Evolution Roadmap

Objective: evolve electron-ipc-helper from a typed IPC utility library into a framework-grade platform with opinionated architecture, strong DX, plugin extensibility, release safety, and performance/security quality gates.

Recommended strategy: ship in incremental, reversible phases. Keep core runtime stable while adding framework layers in separate packages and templates. Enforce quality via automated gates at every phase.

**Steps**
1. Phase 0 - Product Definition and Guardrails (blocks all later phases)
   - Define framework scope boundaries: included (IPC contracts, preload bridge, menus/actions, lifecycle, scaffolding, plugins) and excluded (renderer UI framework lock-in, app-specific backend protocols).
   - Define semantic versioning policy and deprecation windows for APIs.
   - Define success metrics baseline:
     - Setup time to first running app.
     - CI pass rate and time.
     - Runtime cold start budget and IPC p95 latency budget.
     - Defect escape rate from releases.
   - Output artifacts:
     - Framework charter document.
     - Architecture decision records list.
     - Public compatibility policy.

2. Phase 1 - Runtime Consolidation and API Stabilization (parallel with Phase 2 docs work)
   - Stabilize current primitives under explicit module boundaries:
     - core runtime (main/preload/types), app composition (appkit), declarative actions/menus, lifecycle utilities.
   - Define public API surfaces and mark experimental APIs where needed.
   - Add strict API contract tests (type-level and runtime).
   - Add API snapshot checks to prevent accidental breaking changes.
   - Dependency: requires Phase 0 compatibility policy.

3. Phase 2 - Documentation System and Developer Journey (parallel with late Phase 1)
   - Create framework docs IA:
     - quickstart, architecture, migration, patterns, security, performance, release operations.
   - Build golden path tutorials:
     - minimal app, typed IPC flow, menu action routing, lifecycle-managed subprocess.
   - Add troubleshooting matrices for common CI/pnpm/Electron issues.
   - Add versioned docs process tied to release tags.

4. Phase 3 - Scaffolding CLI (first framework layer) (depends on Phase 1 and Phase 2)
   - Create CLI package for project bootstrap.
   - Features:
     - scaffold command with templates (minimal, full-featured).
     - optional modules toggles (menus/actions, lifecycle, appkit).
     - strict defaults for lint/typecheck/test/coverage.
     - non-interactive mode for CI and team automation.
   - Include template verification tests that instantiate projects and run full checks.
   - Add telemetry-free by default behavior.

5. Phase 4 - Plugin Architecture (depends on Phase 3)
   - Define plugin contract:
     - lifecycle hooks (init/start/stop/dispose).
     - typed capability declarations.
     - conflict detection and deterministic plugin ordering.
   - Build 2-3 reference plugins:
     - window state persistence,
     - diagnostics and tracing,
     - updater integration facade.
   - Add plugin sandboxing policy and security review checklist.

6. Phase 5 - Performance, Reliability, and Security Hardening (parallelizable workstreams)
   - Performance workstream:
     - add benchmark suite for IPC invoke throughput and latency.
     - add startup benchmark for template apps.
     - enforce perf budgets in CI with regression threshold alerts.
   - Reliability workstream:
     - chaos-style tests for lifecycle restarts and crash recovery.
     - flaky test quarantine policy and auto-retry strategy.
   - Security workstream:
     - default secure Electron recommendations and preload hardening checks.
     - release provenance, dependency audit, CodeQL, and secret scanning enforcement.

7. Phase 6 - Governance and Ecosystem Readiness (depends on Phases 3-5)
   - Establish contribution model:
     - RFC process for major changes.
     - ownership map and review SLAs.
   - Publish framework maturity model (experimental, beta, stable).
   - Create long-term support policy and maintenance schedule.
   - Launch migration guides from library-only usage to framework usage.

8. Phase 7 - Controlled Launch and Iterative Expansion (depends on Phase 6)
   - Launch as framework preview with a strict compatibility statement.
   - Collect adopter feedback via issue templates and telemetry-free feedback tooling.
   - Prioritize roadmap via measurable adoption and stability signals.
   - Promote to stable once quality/performance/security targets are met for consecutive releases.

**Verification**
1. Quality gates per phase
   - run check, test, coverage, and build on every PR.
   - maintain branch and line coverage above project thresholds with no unchecked regression.
2. Contract validation
   - add API type tests for all public surfaces and migration guard tests for deprecated paths.
3. Performance validation
   - benchmark IPC and startup; fail CI on budget regressions beyond agreed tolerances.
4. Security validation
   - keep CodeQL clean, enforce provenance publishing, and run dependency vulnerability checks.
5. Developer experience validation
   - run scaffolded-project smoke tests in CI and ensure first-run success on supported Node versions.

**Decisions**
- Architecture direction: layered model
  - Layer 1: stable runtime primitives.
  - Layer 2: composition/runtime glue.
  - Layer 3: scaffolding + plugins.
- Compatibility direction: additive-first and explicit deprecations before removals.
- Performance direction: budget-driven CI gates instead of ad-hoc optimization.
- Security direction: secure defaults and release attestations are mandatory.
