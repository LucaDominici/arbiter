---
title: 'ADR-036: Lane/Track Awareness for Multi-Layer Projects'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '036'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-036: Lane/Track Awareness for Multi-Layer Projects

**Status:** Accepted  
**Issue:** #403  
**Date:** 2026-05-05

## Context

Arbiter generated uniform task workflows regardless of target repo structure. Multi-layer projects (frontend + backend + docs) received the same `task.md`, `post-edit-dispatch.mjs`, and `ci.yml` as single-stack repos — a gap relative to the prior-art baseline's track A/B/C/D discipline.

Issue #403 closes this gap for v1.0 GA as part of epic #399 (production baseline parity).

## Decision

### Detection (strict, top-level dirs only)

Three lane types are detected:

- **frontend**: `frontend/package.json` exists AND has a known FE framework dep (`react`, `vue`, `svelte`, `@angular/core`, `solid-js`, `preact`, `next`, `nuxt`, `astro`)
- **backend**: `backend/` exists AND has one of `pom.xml`, `build.gradle`, `build.gradle.kts`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`; OR `backend/package.json` with a known BE Node framework dep (`express`, `fastify`, `hono`, `koa`, `@nestjs/core`)
- **docs**: `docs/` exists AND contains ≥1 `.md` file at top-level or one level deep

Detection returns `{ lanes: [] }` for any project not matching the above. Templates only branch when `lanes.length >= 2` (`_multiLane`).

Turborepo `apps/*`/`services/*` layouts are explicitly out of scope for v1.0.

### Single-lane invariance

For any project where `lanes.length < 2`, all generated artifacts are byte-identical to the pre-#403 output. This is enforced by the `lanes-ci.test.ts`, `lanes-task-md.test.ts`, `lanes-post-edit-dispatch.test.ts`, and `lanes-agents-md.test.ts` invariance assertions.

### Template branching

Three templates gain lane-aware sections, all gated on `_multiLane`:

1. **`task.md.ejs`** — "Lane Discipline" section with cross-stack STOP rule and lane-to-scope table
2. **`post-edit-dispatch.mjs.ejs`** — lane-scoping shim that exits early for files outside declared lanes
3. **`AGENTS.md.ejs`** — "Lane Discipline" section with lane-scope and role columns
4. **`ci.yml.ejs`** — `classify-changes` job promoted from L3-only to `(L3 || _multiLane)`; new `cross-stack-guard` job added

### Cross-stack guard semantics

New `cross-stack-guard` CI job, gated `_multiLane`, depends on `classify-changes`:

- Runs only on pull requests (`if: github.event_name == 'pull_request'`)
- If `backend_changed == 'true' && frontend_changed == 'true'`:
  - **L3**: step exits 1 with error message (hard fail)
  - **L1/L2**: posts advisory PR comment via `actions/github-script@v7`

Requires `pull-requests: write` permission (declared at job level, not workflow level, to minimize blast radius).

### Schema

`lanes?: Lane[]` added to `ArbiterConfigV2`. Optional field; no schema version bump required (additive, non-breaking). Persisted in `arbiter.json` only when non-empty.

## Alternatives Considered

**Turborepo `apps/*` detection**: deferred. Requires recursive package discovery; higher complexity with unclear v1.0 return on investment. Documented in this ADR as explicit out-of-scope.

**Hard-fail at all governance levels**: rejected. Advisory comment at L1/L2 limits blast radius for teams adopting lane discipline incrementally.

**Separate `cross-stack-guard` workflow file**: rejected. Co-locating in `ci.yml` keeps the guard visible in the same PR checks list; separate file adds more generated artifacts without benefit.

## Consequences

- Multi-layer repos detected automatically during `arbiter init`; stored `lanes` field takes precedence over detection on subsequent `arbiter update`
- Cross-product matrix expanded with sparse multi-lane suite (5 configs × 2 templates = 10 extra cases in CANON-13)
- `check-matrix-fixtures.mjs` accepts optional `lanes` field in manifests (backward-compatible, no changes required to existing 9 fixtures)

## Follow-up — 2026-05 (#969)

`scripts/ci-classify-changes.mjs` and its template gained two additional category flags and a fail-closed posture:

- New flags: `e2e_specs` (matches `__tests__/e2e/`, `tests/e2e/`) and `ssot` (matches `docs/SYSTEM/`, `docs/METHOD/SSOT_CORE_SET.md`, `arbiter.json`). Additive — existing 5 flags (`docs_only`, `backend_changed`, `frontend_changed`, `infra_changed`, `high_risk`) are unchanged.
- Fail-closed: any uncaught error resolving the changed-file set emits every flag as `true` and exits 0 — "run everything" rather than "skip everything". Generated projects inherit the same posture (template throws on non-zero `spawnSync` status).
- `--stdin` flag: read newline-delimited paths instead of `git diff`, for unit testing.

Downstream consumer (`01-pr-fast.yml`) still references only the original 5 outputs. Wiring `e2e_specs`/`ssot` into job conditions is intentionally deferred to a follow-up.

## Follow-up — 2026-06 (#1330): per-lane frontend gate

Lanes were detected and stored but the generated gate (`check-all.mjs`) and CI workflows gated only the **primary language**. A `frontend` lane on a non-frontend-spa archetype (the FE app living in a `frontend/` subtree beside a Go/Python/Java/Rust backend) received **zero** FE gating — its typecheck/test/build never ran in any generated gate. (Dogfooding found this in a Go-primary repo that had to hand-write a `check-frontend.mjs` + a frontend CI workflow outside the generated tree to avoid `arbiter update` drift.)

Closure:

- New emitted gate **`scripts/check-frontend-lane.mjs`** (template `scripts/check-frontend-lane.mjs.ejs`): runs the `frontend/` subtree's own `tsc --noEmit` + `vitest run` (and `npm run build` in `full` mode), each step **gate-on-present** — a missing `frontend/package.json` or un-installed `frontend/node_modules` SKIPs cleanly (exit 0) rather than false-failing a partial setup; a present step that genuinely fails is a HARD failure.
- Wired into `check-all.mjs` at L1 **outside** the primary-language branch (the bug was that the FE blocks were nested inside `language === 'typescript'`), gated on the subtree predicate.
- New emitted CI workflow **`18-frontend-lane.yml`** (template `18-frontend-lane.yml.ejs`): path-scoped to `frontend/**`, installs subtree deps (`npm ci --prefix frontend`), runs the lane gate in `full` mode. Emitted for peer/gated-review at L2+.
- Single predicate **`isSubtreeFrontendLane(config)`** (`src/detectors/lanes.ts`): `archetype` defined AND `!== 'frontend-spa'` AND `lanes` includes `frontend`. Used by both the `check-all` and `github` generators so emit/wire/workflow guards stay in lockstep. The `archetype !== undefined` guard mirrors `needsFrontendQuality`. The `frontend-spa` archetype keeps its existing root-level wiring (`16-frontend-quality.yml`, root `_isFE` blocks) — this gate is the polyglot **subtree** complement, lanes-axis driven not archetype-driven.
- Trunk-solo repos gate the FE lane via the `check-all.mjs` `gate-full` CI job (the dedicated path-scoped workflow is the peer/gated-review complement), so the FE lane is gated in both collaboration modes.
