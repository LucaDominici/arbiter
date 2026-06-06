---
generated: true
source: 'docs/REFERENCE/USE-CASE-MATRIX.md'
source_sha: '0ce278959385aa2d0a68ed8e4e7aac6d6979759d'
last_updated: '2026-06-06'
---

# Use-Case Matrix

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/USE-CASE-MATRIX.md](../docs/REFERENCE/USE-CASE-MATRIX.md)

# Use-Case Matrix

Maps each supported language to its canonical use case, proven governance categories, and behavioral test coverage. Tracks the promise that arbiter's generated governance actually gates a real project.

Behavioral tests referenced below spawn the real `dist/cli.js` binary against a tmpdir project and assert observable output/exit-code invariants. All tests live under `__tests__/behavioral/`.

---

## Language Coverage

| Language   | Canonical Use Case                         | Proven Categories                                 | Behavioral Test                                                                               |
| ---------- | ------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TypeScript | Backend web API or frontend SPA with npm   | static_analysis, mutation, contract, coverage     | `__tests__/behavioral/cli-smoke.test.ts` — full init + dry-run (#1039, #1040)                 |
| Java       | Spring Boot / Hexagonal backend with Maven | static_analysis, mutation, contract, architecture | `__tests__/behavioral/kit-commands.test.ts` — kit validate + kit install (#1040)              |
| Python     | FastAPI / Django service with pytest       | static_analysis, coverage, architecture           | `__tests__/behavioral/cli-smoke.test.ts` — init against brownfield-real-python fixture (#800) |
| Go         | net/http or Gin service with go test       | static_analysis, coverage, architecture           | `__tests__/behavioral/cli-smoke.test.ts` — init against brownfield-real-go fixture (#800)     |
| Rust       | Axum / Actix web service with cargo test   | static_analysis, coverage, architecture           | `__tests__/behavioral/verify-commands.test.ts` — verify stack-probe chain (#1040)             |

---

## What "proven" means here

A category is `proven` in `src/compatibility/cross-language-matrix.json` when arbiter has been tested end-to-end against a real project of that stack and the generated governance gate was observed to pass. See `docs/DEVELOPMENT/REAL-PROJECT-TESTING.md` for the fixture testing protocol.

---

## Adding a new row

When a new language is promoted from `beta` → `proven` in the matrix:

1. Add a fixture under `__tests__/fixtures/real-projects/<lang>-library/` with a valid `manifest.json` (INV-32, enforced by `scripts/check-matrix-fixtures.mjs`).
2. Add or extend a behavioral test in `__tests__/behavioral/` that spawns `arbiter init` against that fixture and asserts a passing exit code.
3. Add the row to this table with the correct test path.

See `docs/DEVELOPMENT/TESTING-STRATEGY.md` §Matrix Testing for cross-product test conventions.

## See Also

- [[development-testing-strategy]] — related
