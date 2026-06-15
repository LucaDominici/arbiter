---
generated: true
source: 'docs/PRODUCT/GAP.md'
source_sha: '2d06146316e93451c4a7ce820a46caf415b1b33e'
last_updated: '2026-06-15'
---

# GAP — arbiter gap register

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/GAP.md](../docs/PRODUCT/GAP.md)

# GAP — arbiter gap register

> Generated from FEATURE_MATRIX.md · constraint-scan · convergence reports.
> Refresh: `node scripts/gen-gap.mjs --write`. Gate: `node scripts/gen-gap.mjs --check`.

<!-- GAP_START -->

## v1 Blockers

| feature_id | capability            | status  | issue | notes                                                 |
| ---------- | --------------------- | ------- | ----- | ----------------------------------------------------- |
| REQ-033    | Kit experimental gate | Missing | #1151 | Gate is fiction — not enforced against real kit state |

## Feature Gaps

| feature_id | capability                                               | status  | severity | blocks_v1 | issue | notes                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------- | ------- | -------- | --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-033    | Kit experimental gate                                    | Missing | high     | yes       | #1151 | Gate is fiction — not enforced against real kit state                                                                                                                                                                                                                                                                                                                      |
| REQ-001    | Architecture enforcement (hexagonal / layered)           | Partial | medium   | no        | —     | ArchUnit (Java) + ESLint boundaries (TS); cross-stack coverage partial                                                                                                                                                                                                                                                                                                     |
| REQ-002    | Audit trail / 21CFR scaffold                             | Partial | medium   | no        | #1156 | pharma overlay = Java JPA/ArchUnit (KIT N73-75); sox/gdpr/generic overlays = language-neutral L4 audit-trail policy + gate rules under docs/compliance/, decoupled from the pharma Java scaffolding (#1156, src/templates/audit/generic/)                                                                                                                                  |
| REQ-003    | Static analysis & linting                                | Partial | medium   | no        | —     | ESLint + tsc; complexity + coverage gates wired                                                                                                                                                                                                                                                                                                                            |
| REQ-004    | Test framework wiring                                    | Partial | medium   | no        | —     | Vitest (TS), JUnit 5 (Java), pytest (Python), go test, cargo test                                                                                                                                                                                                                                                                                                          |
| REQ-005    | Test profiles & TDD evidence                             | Partial | medium   | no        | —     | Coverage thresholds + TDD evidence gate wired at L2+                                                                                                                                                                                                                                                                                                                       |
| REQ-006    | Integration / mutation / behavioral / contract testing   | Partial | medium   | no        | —     | Mutation (Java L2+), BDD, contract testing all behind L2+ gates                                                                                                                                                                                                                                                                                                            |
| REQ-007    | CI/CD pipeline & workflow runners                        | Partial | medium   | no        | —     | GH Actions workflows generated; workflow-runner gate wired                                                                                                                                                                                                                                                                                                                 |
| REQ-008    | E2E & performance testing                                | Partial | medium   | no        | —     | Playwright (TS/Python) + k6 perf; archetype-gated                                                                                                                                                                                                                                                                                                                          |
| REQ-009    | Gate script validation                                   | Partial | medium   | no        | —     | check-all.mjs generated + wired; 29 gates wired-but-untested (GAP)                                                                                                                                                                                                                                                                                                         |
| REQ-010    | Quality gate scripts                                     | Partial | medium   | no        | —     | Debt ratchet, duplication, bloat, dead-code gates generated                                                                                                                                                                                                                                                                                                                |
| REQ-011    | Security toolchain                                       | Partial | medium   | no        | —     | Gitleaks, npm audit, STRIDE enforcement; SAST level-gated                                                                                                                                                                                                                                                                                                                  |
| REQ-012    | Git/GitHub governance                                    | Partial | medium   | no        | —     | Branch protection, label defs, Actions pins; all L2+                                                                                                                                                                                                                                                                                                                       |
| REQ-013    | Documentation generation                                 | Partial | medium   | no        | —     | MASTER_TEST_PLAN, CODING_STANDARDS, ADR template, COMMANDS.md                                   

*[content truncated — see source for full text]*

## See Also

- [[product-feature-matrix]] — related
- [[product-status]] — related
