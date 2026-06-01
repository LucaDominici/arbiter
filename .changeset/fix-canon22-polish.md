---
'arbiter': patch
---

fix(quality): CANON-22 red-team polish — gate-on-present lint:css, fail-closed duplication ratchet, ADR-076

Closes the non-blocking findings from #1136's red-team review:

- **Generated `check-all` `lint:css`** now runs only when a `.stylelintrc` config is present, so frontend targets don't FAIL CI on a stylelint config that no generator emits yet (emitting the #352 design-token config is a tracked follow-up). Matches the sibling `fsd-boundaries` gate-on-present pattern.
- **Debt-ratchet duplication collector is fail-closed:** jscpd writes no report at 0 clones, so report-absence alone can't mean "clean". The collector now records 0% only on a clean (exit 0) run with no report, parses the report when present, and **omits** the metric (ratchet skips, not a false 0%) when jscpd fails — so a crashed run can no longer silently mask duplication. Dual-sided (`scripts/debt-lib.mjs` + template).
- **Added ADR-076** recording the CANON-22 evidence-tiering + gate-un-blinding decision (`docs/SYSTEM/DECISIONS.md` is frozen; new ADRs live in `docs/ADR/`).

Two flagged items were intentionally not changed (rationale in the plan): the `src/adapters/index.ts` knip `entry` is already honestly recorded in the burn-down audit (demoting it nets more findings, not fewer), and `coverage.ts` emitting `vitest.config.ts` for `multi` is legitimate — that config is consumed by test execution, unlike the gate-only `.jscpd.json`.
