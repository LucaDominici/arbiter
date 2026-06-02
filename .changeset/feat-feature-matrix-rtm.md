---
'arbiter': minor
---

feat(governance): product-truth FEATURE_MATRIX v1 — generated + gated RTM (INV-112, CANON-23)

Materializes the reconciliation audit as arbiter's committed Product-Truth bible:

**Track A (self-doc):** `docs/PRODUCT/FEATURE_MATRIX.md` — 50 rows, all 77 KIT dims covered,
conservatively seeded (Partial/Done max; no Verified from seed). Status ladder:
Missing → Partial → Done → Verified (fail-closed, machine-validated).

**Gate:** `scripts/check-feature-matrix.mjs` (INV-112, L1 fail-closed) validates:

- Status ladder (Verified ⟹ all 4 refs non-empty + files exist)
- KIT-dim coverage via `kit_dims` column join against `src/kit/catalog.json`
- Counter integrity (summary row counts match actual)
- L3+ DoD: Done/Verified rows must have test_ref file present
- L4: audit_trail-category rows require code_ref + test_ref
- Level injection via `--level L2|L3|L4` / `ARBITER_MATRIX_LEVEL` env for fixture testing

**Track B (governed projects):** `src/generators/feature-matrix.ts` + `src/templates/docs/FEATURE_MATRIX.md.ejs`
scaffold the matrix for target projects at L2+ (skipIfExists, user-owned after first write).

**Export:** `arbiter feature-matrix export --format csv|xlsx` — CSV via hand-rolled RFC-4180
(reuses `src/kit/csv.ts` pattern; zero new dep), xlsx via lazy-imported `exceljs`.

**INV-112:** `tier:governance`, `alwaysActive:true`, `minGovernanceLevel:'L2'`, `selfOnly:false`.
**CANON-23:** RTM-required-by-level; promoted to INV-112.

**Parity:** AGENTS.md + GLOBAL_INVARIANTS.md + CLI ref + doc index all updated.
Count tests updated: 109 → 110 invariants (5 assertions).

**GAP register:** 10 issues filed (#1149–#1158) for all Partial/Missing rows and rigor holes
(a11y, Kotlin, kit-gate fiction, anti-drift orphan, CANON-09 blind spot, 29 untested gates,
17 undocumented commands, generic L4 audit-trail, dead config, CANON parity).
