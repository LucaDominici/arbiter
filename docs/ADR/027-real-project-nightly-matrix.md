# ADR-027 — Real-Project Nightly Matrix

**Status:** Accepted
**Date:** 2026-04-16
**Issue:** #87 (MF — Real-Project Nightly Matrix, Phase 9.5 Foundation)

---

## Context

Arbiter generates quality gates for five language ecosystems (TypeScript, Java, Rust, Go, Python). The existing test suite verifies that generated file _content_ matches expected templates, but nothing ever executes the generated gate against a real project build. A breaking change in a non-TS template (e.g., a malformed `build.gradle` checkpoint, a bad Cargo flag, a wrong pytest invocation) passes unit tests and ships silently.

The Viafera-alignment review (H10) identified this as the single largest reliability gap: no multi-language end-to-end coverage.

---

## Decision

Ship a nightly GitHub Actions workflow (`real-project-matrix.yml`) that:

1. Stages minimal-but-real fixture projects under `__tests__/fixtures/real-projects/`.
2. Runs the full Arbiter pipeline on each — `arbiter init → arbiter verify → check-all.mjs` — inside `$RUNNER_TEMP/project` (isolated from the repository).
3. Enforces a ≥10-pass floor via an aggregator step (INV-32).

A companion invariant script (`scripts/check-matrix-fixtures.mjs`) enforces at the L1 gate that every language with ≥1 "proven" maturity cell in `src/compatibility/cross-language-matrix.json` has at least one fixture.

---

## Fixture Design

Each fixture is a compilable, testable minimum:

- One source file, one test file, a real build config (not a stub).
- A `manifest.json` declaring `language`, `archetype`, `levels`, and optional `buildTool`.
- Model: `__tests__/fixtures/brownfield-java/` — the existing integration fixture that ships real Gradle and Java source.

v1 ships 8 fixtures × 2 levels = 16 matrix jobs. The ≥10 success floor is comfortably cleared even with 6 infrastructure failures.

---

## Why Nightly (Not Per-PR)?

Real toolchain downloads (Gradle, Rust toolchain, Go, Python) add 3–8 minutes per job. At 16 cells, that is 48+ minutes of runner time per PR. The cost is not justified for every pull request.

Nightly (03:00 UTC) is a well-established cadence for integration suites that test external dependencies. A regression becomes visible within 24 hours of merge — acceptable for template drift.

---

## Why Self-Hosted Runner?

INV-13 (ADR-023) mandates `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` for all Linux jobs. The `docker-ci-build` runner has Node and the Docker daemon pre-installed. Per-language toolchains are installed per-job via `actions/setup-*`.

Using `ubuntu-latest` (GitHub-hosted) is prohibited by INV-13 and would expose the workflow to quota pressure on free plans.

---

## Why Per-Language Setup Actions?

`docker-ci-build` does not pre-install Java, Rust, Go, or Python beyond system defaults. Installing via `actions/setup-java`, `actions/setup-go`, `actions/setup-python`, and `dtolnay/rust-toolchain` is the same pattern used inside arbiter's generated workflow templates (`src/templates/github/workflows/ci.yml.ejs`). This ensures the nightly workflow exercises the same setup path that arbiter recommends to downstream users.

---

## Why `continue-on-error: true` on Matrix Cells?

Three failure modes exist per cell:

1. **Arbiter bug**: init/verify/check-all produces wrong output.
2. **Fixture misconfiguration**: the fixture itself is broken (e.g., syntax error in source).
3. **Runner infrastructure**: setup action fails, network blip, disk pressure.

Mode 3 is noise. With `continue-on-error: false` (the default), a single infrastructure failure poisons all remaining matrix jobs and obscures real regressions. The ≥10 floor in the aggregate step tolerates up to 6 infrastructure failures (out of 16) while still signalling a real regression if ≥7 cells fail.

This is a v1 decision. Once the runner image is hardened and infrastructure failures become rare, `continue-on-error` can be revisited.

---

## Why GitHub API in the Aggregator?

GitHub Actions provides `needs.<job>.result` for a scalar result (`success`/`failure`/…) but not for individual matrix cell outcomes when `continue-on-error: true` — the matrix job as a whole always shows `success` in that case. The only reliable way to count individual cell successes is to query the GitHub Jobs API (`/repos/{owner}/{repo}/actions/runs/{run_id}/jobs`), filter jobs whose name starts with `run (`, and count `conclusion === "success"`.

Node 20's built-in `fetch` makes this practical without additional dependencies.

---

## Risks and Mitigations

| Risk                                                                                                    | Mitigation                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docker-ci-build` lacks pre-installed toolchains; `setup-*` actions may hit network issues              | `continue-on-error: true` + ≥10 floor. Follow-up issue to harden runner image.                    |
| Spring Boot fixture is heavyweight — `./gradlew test` may exceed 15 min                                 | Pinned minimal Spring starter (web only). Matrix `timeout-minutes: 30`.                           |
| `arbiter verify` fails on freshly-installed toolchains (version drift vs. `cross-language-matrix.json`) | Accept verify as a distinct signal; update `cross-language-matrix.json` in follow-up if spurious. |
| L3 tooling (pitest, tarpaulin, mutmut) installation cost                                                | L3 deferred in v1. ADR notes the deferral explicitly.                                             |

---

## Out of Scope (Follow-Ups)

- L3 nightly coverage (needs pitest/tarpaulin/mutmut on runner image).
- `cli`, `data-pipeline`, `embedded` archetype fixtures (need framework detector extensions not yet landed).
- Per-category fixture granularity (one mutation fixture, one contract fixture, etc.).
- README matrix status badge.
- Runner image hardening.

---

## Consequences

- Every generator regression surfaces within 24 hours of merge.
- INV-32 prevents new languages from being added to `cross-language-matrix.json` as "proven" without a corresponding fixture.
- `scripts/check-matrix-fixtures.mjs` runs at L1, blocking PRs that would leave a proven language without a fixture.
