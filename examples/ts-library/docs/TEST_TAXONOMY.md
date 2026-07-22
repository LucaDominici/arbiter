# Test Taxonomy — ts-library-fixture

<!-- arbiter-managed: test-pyramid-profile (INV-89) -->
<!-- Archetype: library -->

This document defines the test pyramid for **ts-library-fixture**.
Each level maps to a CI stage in `ci.yml` and a check in `scripts/check-all.mjs`.

---

## Pyramid Levels

| Level | Description | Tools |
|-------|-------------|-------|
| **L1 Unit** | Unit tests for all public API surface — every exported function/class | `JUnit/pytest/vitest/cargo test` |
| **L2 Property-Based** | Generative / property-based tests to find edge cases | `fast-check, Hypothesis, proptest, QuickCheck` |


---

## Conventions

- **L1 tests** run on every commit (pre-commit hook via `scripts/check-all.mjs L1`).
- **L2+ tests** run on push/PR (`scripts/check-all.mjs L2`).
- Test files live next to the code they test (co-located) or in a top-level `tests/` directory.
- Every public function/method must have at least one test.

- Property-based tests must cover all public API inputs. Use `fast-check` / `Hypothesis` / `proptest`.


---

## Test Type Codes

| Code | Name | Description |
|------|------|-------------|
| **UT** | Unit Test | Pure function / class isolation — no I/O, no DB (INV-26) |
| **IT** | Integration Test | Two or more real collaborators (DB, queue, cache) — Testcontainers where applicable |
| **AU** | API / Contract Unit | HTTP boundary — input validation, error contracts, OpenAPI parity (INV-47) |
| **ST** | System / E2E Test | Full stack — real infra, real browser (Playwright) where applicable |
| **SC** | Scenario / BDD Test | Gherkin scenarios — cross-module behavior from the user's perspective |
| **SN** | Snapshot Test | Golden-file / snapshot regressions — UI, serialisation, report output |
| **E2E** | End-to-End Test | Alias for ST; used when framing is user-journey centric |

---

## Universal Quality Dimensions

Every test level must address the applicable subset of the 17 universal dimensions below.
Primary codes indicate which test type most naturally covers each dimension.

| # | Dimension | Primary Code | INV Reference |
|---|-----------|-------------|---------------|
| 1 | Owner isolation — tenant/user data cannot bleed across boundaries | IT / AU | INV-19 |
| 2 | RBAC — role permissions enforced at every endpoint and query | AU / IT | INV-19 |
| 3 | Input validation — all public inputs validated; invalid inputs rejected with correct status | AU / UT | INV-47 |
| 4 | Error contracts — error codes, messages, and HTTP status are stable and documented | AU | INV-47 |
| 5 | OpenAPI parity — generated/written spec matches actual handler behaviour | AU | INV-47 |
| 6 | Pagination — list endpoints honour page/limit/cursor; no unbounded scans | AU / IT | INV-14 |
| 7 | Idempotency — mutating operations safe to retry (PUT / PATCH / DELETE) | AU / IT | INV-14 |
| 8 | Migration integrity — DB migrations are reversible and tested in CI | IT | INV-30 |
| 9 | Observability — structured logs emitted for all error paths; spans created for I/O | UT / IT | INV-17 |
| 10 | Perf / N+1 — no N+1 queries; latency budgets asserted in integration layer | IT | INV-14 |
| 11 | Failure recovery — circuit-breakers, retries, and fallbacks exercised | IT / ST | INV-17 |
| 12 | DTO roundtrip — serialise → deserialise identity holds for every public DTO | UT / AU | INV-47 |
| 13 | Entity–schema parity — ORM entity fields match DB column types | IT | INV-30 |
| 14 | Cross-module ref integrity — FK/ref constraints never violated in test fixtures | IT | INV-30 |
| 15 | Profile security — user profile data never returned to wrong owner | AU / IT | INV-19 |
| 16 | Backward compat — existing clients unaffected by new release (schema + API) | AU / ST | INV-47 |
| 17 | Contract test coverage — published consumer contracts verified per deploy | AU | INV-48 |


---

## Decision Matrix — Change Type → Required Dimensions

| Change Type | Mandatory Dimensions | Recommended Codes |
|-------------|----------------------|-------------------|
| New API endpoint | 1–5, 16 | AU + IT |
| New DB entity / migration | 8, 13, 14 | IT |
| Auth / permission change | 1, 2, 15 | AU + IT |
| New list / search endpoint | 6, 10 | AU + IT |
| Mutating endpoint (create/update/delete) | 7, 14 | AU + IT |
| New public DTO / schema | 4, 5, 12, 16 | AU + UT |
| External service integration | 11 | IT + ST |
| Background job / worker | 9, 11 | IT |
| UI feature | 3, 4 | SN + ST |
| Cross-module feature | 14, 15 | IT + SC |
