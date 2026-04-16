# Matrix Fixture Policy (INV-32)

- Every language with ≥1 `proven` cell in `src/compatibility/cross-language-matrix.json` MUST have at least one fixture under `__tests__/fixtures/real-projects/` with a valid `manifest.json`
- Fixture `manifest.json` must contain: `language`, `archetype`, `levels` (required fields)
- Enforced by `scripts/check-matrix-fixtures.mjs` (L1 gate) — fails the gate pre-merge
- Promoting a language from `beta` → `proven` in the matrix without adding a fixture is a gate violation (INV-32)
- See `docs/DEVELOPMENT/REAL-PROJECT-TESTING.md` for how to create a new fixture
