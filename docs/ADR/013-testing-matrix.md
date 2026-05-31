---
title: 'ADR-013: Fixture-based per-claim testing'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '013'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-013: Fixture-based per-claim testing

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Arbiter generates governance files for a matrix of inputs: 5 languages, 4 AI tools, 3 governance levels, 3 conflict resolution strategies (backup+replace, deep merge, skipIfExists), and a brownfield detection layer. A coverage percentage alone cannot express whether all these combinations are tested correctly — 85% line coverage is satisfied by testing only the happy path for the most common input.

The project needs a testing strategy that:

1. Validates every _documented claim_, not just every code path
2. Covers the full input matrix without exponential test count growth
3. Catches filesystem and path bugs that mocked `fs` would hide
4. Is sustainable for contributors adding new generators or languages

## Decision

Every testable claim in the documentation (ADRs, architecture docs, milestones, reference docs) maps to at least one dedicated test case. The test strategy is **per-claim**, not per-function.

**Core principles:**

| Principle                 | Implementation                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Real filesystem, no mocks | `mkdtempSync` + `rmSync` in `beforeEach`/`afterEach`; exercises real path resolution                                |
| Per-claim, not per-line   | Each `it()` block names the claim being tested (e.g., "AGENTS.md includes no-any invariant for TypeScript")         |
| Fixture-minimal           | Each test places only the marker files needed for detection; no shared monolithic fixtures                          |
| Generator isolation       | Tool output tests call individual generators directly, not `runGenerators`; integration tests call the full command |

**Test categories and their claims:**

| Category        | Directory                | Claims validated                                                                          |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| **Detectors**   | `__tests__/detectors/`   | Language, framework, build, git, existing-state detection per signal                      |
| **Utils**       | `__tests__/utils/`       | File write strategies (skipIfExists, backup, merge), config roundtrip, template rendering |
| **Tool output** | `__tests__/tools/`       | Generator output content per tool (Claude, Codex, Cursor, Copilot, GitHub)                |
| **Matrix**      | `__tests__/matrix/`      | Full `arbiter init` → file content per language (TS, Java, Rust, Go, Python)              |
| **Brownfield**  | `__tests__/brownfield/`  | Conflict resolution per scenario (existing AGENTS.md, .claude/, ai-rulez, settings.json)  |
| **Integration** | `__tests__/integration/` | Full command flows: init, update, diff; re-run idempotency                                |

**Coverage target:** 85% line coverage, enforced by `vitest --coverage` in CI. Coverage is a floor, not a goal — the per-claim criterion is primary.

**File naming:** Test files mirror `src/` structure under `__tests__/`. Detector tests are in `__tests__/detectors/`, matching `src/detectors/`. Tool output tests are in `__tests__/tools/`, matching the generator domain.

## Rationale

**Why per-claim instead of per-function?** A function like `generateClaude()` has one test entry point but ~15 behavioral claims (settings.json structure, hook script content, rules presence, command content, language-specific hooks). A per-function test (one `describe` with one `it`) would either be a monolithic assertion block or miss most claims. Per-claim tests make each failure immediately actionable.

**Why no `fs` mocking?** Mocked filesystem operations hide real-world bugs: path separators, `mkdirSync` options, permission errors, and trailing-slash issues all pass with mocks but fail on disk. Every arbiter bug reported during M9 real-repo validation was a path or permission bug that would have been caught by real-disk tests. The cost — slightly slower tests (~12s for 208 cases) — is acceptable.

**Why fixture-minimal construction?** Shared fixture directories (a pre-built `test-project/` folder) create fragility: a test that adds a file to the fixture directory changes behavior for all other tests. `mkdtempSync` guarantees isolation at the cost of setup verbosity, which the `createTestProject(language)` helper abstracts.

**Why generator isolation in tool output tests?** Running `runGenerators(config)` for every tool output assertion means all 8 generators fire for every test. This makes tests slower and creates false dependencies — a bug in the GitHub generator would cause Claude output tests to fail. Calling `generateClaude(config)` directly makes each test's scope explicit.

### Alternatives rejected

- **Snapshot testing** — Snapshots validate exact output but are brittle to template whitespace changes. When Prettier reformats a template, all snapshots must be updated. Per-claim assertions target specific substrings, surviving reformatting.
- **Integration-only testing** — Running the full `arbiter init` for every case is slow (~500ms per run) and obscures which generator is responsible for a failure. The multi-tier approach uses integration tests only for end-to-end flows.
- **Mocked `fs`** — Faster but misses the class of real-world bugs described above. Rejected in favor of temp dirs.

## Consequences

**Positive:**

- Every ADR claim ("backup+replace is used for canonical files"), milestone claim ("full init→output validated for all 5 languages"), and architecture claim ("settings.json deep-merge unions hooks by matcher") has a corresponding test.
- Test failures are precisely named and immediately actionable.
- The real-filesystem approach catches bugs that survive unit testing but fail on target machines.

**Negative:**

- Test suite size is larger than a per-function approach would require (208 tests vs. ~60 function-level tests).
- Execution time is ~12s for the full suite due to real disk I/O. Fast enough for CI; slightly slow for watch mode on large changes.
- Contributors adding new generators or languages must identify and test the claims in the corresponding documentation, not just achieve line coverage.
