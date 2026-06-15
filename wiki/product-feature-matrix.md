---
generated: true
source: 'docs/PRODUCT/FEATURE_MATRIX.md'
source_sha: '38d14051e91d4bdbe345d398cdfebe54dd4d30d0'
last_updated: '2026-06-14'
---

# FEATURE_MATRIX — Product Truth RTM

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/FEATURE_MATRIX.md](../docs/PRODUCT/FEATURE_MATRIX.md)

# FEATURE_MATRIX — arbiter Product Truth RTM

> **Canonical source of product completeness.** This file is the single authoritative record
> of what arbiter delivers, at what governance level, with what evidence.
>
> **Gate:** `scripts/check-feature-matrix.mjs --check` (L1, fail-closed). To regenerate the
> table block run `node scripts/check-feature-matrix.mjs --write`.
>
> **Export:** `arbiter feature-matrix export --format csv|xlsx` for PM/stakeholder views.

---

## Status vocabulary

| Status     | Meaning                              | Required fields                                               |
| ---------- | ------------------------------------ | ------------------------------------------------------------- |
| `Missing`  | No implementation — tracked by issue | `issue_ref` in `#NNN` format                                  |
| `Partial`  | Code exists; test/doc incomplete     | `code_ref` non-empty                                          |
| `Done`     | Code + test + doc all present        | `code_ref` + `test_ref` + `doc_ref` non-empty and files exist |
| `Verified` | Full evidence chain — gate-checked   | all four refs non-empty, `test_ref` title parsed              |

Promotion is fail-closed (cannot skip a step).

---

## KIT Dimension Legend

| Category           | Dims         | Description                                 |
| ------------------ | ------------ | ------------------------------------------- |
| architecture       | N01–N07      | Hexagonal/layered architecture enforcement  |
| audit_trail        | N08, N73–N75 | 21CFR / tamper-evident audit log            |
| static_analysis    | N09–N16      | Linting, type-safety, complexity            |
| test_framework     | N17–N23      | Unit test runner & mocking                  |
| test_profiles      | N24–N26      | Coverage profiles & TDD evidence            |
| test_types         | N27–N33      | Integration, mutation, behavioral, contract |
| cicd               | N34–N40      | CI/CD pipeline & workflow runners           |
| e2e_perf           | N41–N44      | E2E browser testing & k6 performance        |
| scripts_validation | N45–N50      | Gate scripts validation                     |
| scripts_quality    | N51–N54      | Quality gate scripts                        |
| security           | N55–N58      | Secrets, vulnerability, SAST                |
| git_github         | N59–N62      | Branch protection, labels, Actions          |
| documentation      | N63–N68      | Doc generation & validation                 |
| configuration      | N69–N72      | arbiter.json config surface                 |
| a11y               | N76          | Accessibility enforcement                   |
| module_boundaries  | N77          | Module import boundary enforcement          |
| resilience         | N78          | Circuit-breaker/retry/rate-limiter/timeout  |

---

<!-- FEATURE_MATRIX_START -->

| feature_id | capability                                                       | kit_dims                        | level | status   | code_ref                                                                                                                                    | test_ref                                                                                                                                 | doc_ref                                                                         | issue_ref | note                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------- | ------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001    | Architecture enforcement (hexagonal / layered)                   | N01,N02,N03,N04,N05,N06,N07     | L2    | Partial  | src/generators/boundaries.ts                                                                                                                |                                                                                                                                          |                                                                                 |           | ArchUnit (Java) + ESLint boundaries (TS); cross-stack coverage partial                                                                                                                                                                                                                                                                                                                                                                       |
| REQ-002    | Audit trail / 21CFR scaffold                                     | N08,N73,N74,N75                 | L4    | Partial  | src/generators/pharma.ts                                                                                                                    |                                                                                                                                          |                                                                                 | #1156     | pharma overlay = Java JPA/ArchUnit (KIT N73-75); sox/gdpr/generic overlays = language-neutral L4 audit-trail policy + gate rules under docs/compliance/, decoupled from the pharma Java scaffolding (#1156, src/templates/audit/generic/)                                                                                                                                                                                                    |
| REQ-003    | Static analysis & linting                                        | N09,N10,N11,N12,N13,N14,N15,N16 | L2    | Partial  | src/generators/quality.ts                                                                                                                   |                                                                                                                                          |                                                                                 |           | ESLint + tsc; complexity + coverage gates wired                                                                                                                                                                                                                                                                                                                                                                                              |
| REQ-004    | Test framework wiring                                            | N17,N18,N19,N20,N21,N22,N23     | L2    | Partial  | src/generators/quality.ts                                                                                                                   |                                                                                                         

*[content truncated — see source for full text]*
