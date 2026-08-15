---
title: 'Use-Case Matrix'
doc_version: '1.0.0'
status: active
last_review: '2026-05-24'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['TESTING-STRATEGY.md']
---

# Use-Case Matrix

Maps each supported language to its canonical use case, proven governance categories, and behavioral test coverage. Tracks the promise that arbiter's generated governance actually gates a real project.

Behavioral tests referenced below spawn the real `dist/cli.js` binary against a tmpdir project and assert observable output/exit-code invariants. All tests live under `__tests__/behavioral/`.

---

## Language Coverage

| Language   | Canonical Use Case                         | Proven Categories                                 | Behavioral Test                                                                               |
| ---------- | ------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TypeScript | Backend web API or frontend SPA with npm   | static_analysis, mutation, contract, coverage     | `__tests__/behavioral/cli-smoke.test.ts` — full init + dry-run (#1039, #1040)                 |
| Java       | Spring Boot / Hexagonal backend with Maven | static_analysis, mutation, contract, architecture | `__tests__/integration/brownfield-baseline.test.ts` — init against brownfield-java fixture|
| Python     | FastAPI / Django service with pytest       | static_analysis, coverage, architecture           | `__tests__/behavioral/cli-smoke.test.ts` — init against brownfield-real-python fixture (#800) |
| Go         | net/http or Gin service with go test       | static_analysis, coverage, architecture           | `__tests__/behavioral/cli-smoke.test.ts` — init against brownfield-real-go fixture (#800)     |
| Rust       | Axum / Actix web service with cargo test   | static_analysis, coverage, architecture           | `__tests__/behavioral/verify-commands.test.ts` — verify stack-probe chain (#1040)             |

---

## What "proven" means here

A category is `proven` in `src/compatibility/cross-language-matrix.json` when arbiter has been tested end-to-end against a real project of that stack and the generated governance gate was observed to pass. See `docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md` for the fixture testing protocol.

---

## Adding a new row

When a new language is promoted from `beta` → `proven` in the matrix:

1. Add a fixture under `__tests__/fixtures/real-projects/<lang>-library/` with a valid `manifest.json` (INV-32, enforced by `scripts/check-matrix-fixtures.mjs`).
2. Add or extend a behavioral test in `__tests__/behavioral/` that spawns `arbiter init` against that fixture and asserts a passing exit code.
3. Add the row to this table with the correct test path.

See `docs/internal/METHOD/TESTING.md` for cross-product test conventions.
