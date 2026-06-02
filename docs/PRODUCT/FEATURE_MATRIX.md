---
title: 'FEATURE_MATRIX — Product Truth RTM'
doc_version: '1.0.0'
status: active
last_review: '2026-06-02'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product', 'kind/governance']
related: ['AGENTS.md', 'src/kit/catalog.json', 'scripts/check-feature-matrix.mjs']
---

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

---

<!-- FEATURE_MATRIX_START -->

| feature_id | capability                                             | kit_dims                        | level | status  | code_ref                                | test_ref | doc_ref | issue_ref | note                                                                   |
| ---------- | ------------------------------------------------------ | ------------------------------- | ----- | ------- | --------------------------------------- | -------- | ------- | --------- | ---------------------------------------------------------------------- |
| REQ-001    | Architecture enforcement (hexagonal / layered)         | N01,N02,N03,N04,N05,N06,N07     | L2    | Partial | src/generators/boundaries.ts            |          |         |           | ArchUnit (Java) + ESLint boundaries (TS); cross-stack coverage partial |
| REQ-002    | Audit trail / 21CFR scaffold                           | N08,N73,N74,N75                 | L4    | Partial | src/generators/pharma.ts                |          |         |           | Java-only; L4 generator not linked to governanceLevel (GAP)            |
| REQ-003    | Static analysis & linting                              | N09,N10,N11,N12,N13,N14,N15,N16 | L2    | Partial | src/generators/quality.ts               |          |         |           | ESLint + tsc; complexity + coverage gates wired                        |
| REQ-004    | Test framework wiring                                  | N17,N18,N19,N20,N21,N22,N23     | L2    | Partial | src/generators/quality.ts               |          |         |           | Vitest (TS), JUnit 5 (Java), pytest (Python), go test, cargo test      |
| REQ-005    | Test profiles & TDD evidence                           | N24,N25,N26                     | L2    | Partial | src/generators/evidence-backlog.ts      |          |         |           | Coverage thresholds + TDD evidence gate wired at L2+                   |
| REQ-006    | Integration / mutation / behavioral / contract testing | N27,N28,N29,N30,N31,N32,N33     | L2    | Partial | src/generators/integration-testing.ts   |          |         |           | Mutation (Java L2+), BDD, contract testing all behind L2+ gates        |
| REQ-007    | CI/CD pipeline & workflow runners                      | N34,N35,N36,N37,N38,N39,N40     | L2    | Partial | src/generators/github.ts                |          |         |           | GH Actions workflows generated; workflow-runner gate wired             |
| REQ-008    | E2E & performance testing                              | N41,N42,N43,N44                 | L2    | Partial | src/generators/playwright-ts.ts         |          |         |           | Playwright (TS/Python) + k6 perf; archetype-gated                      |
| REQ-009    | Gate script validation                                 | N45,N46,N47,N48,N49,N50         | L2    | Partial | src/generators/check-all.ts             |          |         |           | check-all.mjs generated + wired; 29 gates wired-but-untested (GAP)     |
| REQ-010    | Quality gate scripts                                   | N51,N52,N53,N54                 | L2    | Partial | src/generators/debt-gates.ts            |          |         |           | Debt ratchet, duplication, bloat, dead-code gates generated            |
| REQ-011    | Security toolchain                                     | N55,N56,N57,N58                 | L2    | Partial | src/generators/security.ts              |          |         |           | Gitleaks, npm audit, STRIDE enforcement; SAST level-gated              |
| REQ-012    | Git/GitHub governance                                  | N59,N60,N61,N62                 | L2    | Partial | src/generators/github-setup.ts          |          |         |           | Branch protection, label defs, Actions pins; all L2+                   |
| REQ-013    | Documentation generation                               | N63,N64,N65,N66,N67,N68         | L2    | Partial | src/generators/docs.ts                  |          |         |           | MASTER_TEST_PLAN, CODING_STANDARDS, ADR template, COMMANDS.md          |
| REQ-014    | Project configuration surface                          | N69,N70,N71,N72                 | L1    | Partial | src/wizard/types.ts                     |          |         |           | arbiter.json schema; dead config: strictnessTier, databaseEngine (GAP) |
| REQ-015    | Accessibility (a11y) enforcement                       | N76                             | L2    | Missing |                                         |          |         | #1149     | No a11y generator or gate implemented                                  |
| REQ-016    | Module boundary enforcement                            | N77                             | L2    | Partial | src/generators/boundaries.ts            |          |         |           | ESLint-import-boundaries (TS); cross-stack not fully covered           |
| REQ-017    | CLI command surface — 34 registered commands           |                                 | L1    | Partial | src/cli.ts                              |          |         |           | 34 commands wired+tested; 17 undocumented in CLI ref (GAP)             |
| REQ-018    | Generator scaffold — 61 registered generators          |                                 | L1    | Partial | src/generators/registry.ts              |          |         |           | 61 generators registered; anti-drift-validators orphan (GAP)           |
| REQ-019    | Invariant catalog & AGENTS.md parity                   |                                 | L1    | Partial | src/invariants/catalog.ts               |          |         |           | 110 invariants; catalog↔AGENTS parity gate wired (INV-110)             |
| REQ-020    | Governance level dial (L1–L4)                          |                                 | L1    | Partial | src/wizard/types.ts                     |          |         |           | L1–L4 graduated enforcement; minGovernanceLevel filter wired           |
| REQ-021    | TypeScript stack support                               |                                 | L1    | Partial | src/generators/boundaries.ts            |          |         |           | Architecture + quality + security + testing fully generated            |
| REQ-022    | Java stack support                                     |                                 | L1    | Partial | src/generators/archunit.ts              |          |         |           | ArchUnit, JUnit 5, mutation (PIT), pharma overlay                      |
| REQ-023    | Python stack support                                   |                                 | L2    | Partial | src/generators/playwright-python.ts     |          |         |           | L3+ loud per matrix; core generators beta                              |
| REQ-024    | Go stack support                                       |                                 | L2    | Partial | src/generators/go-boundaries.ts         |          |         |           | L3+ loud; go-boundaries + go test wired                                |
| REQ-025    | Rust stack support                                     |                                 | L2    | Partial | src/generators/rust-boundaries.ts       |          |         |           | L3+ loud; cargo test + clippy wired                                    |
| REQ-026    | Kotlin stack support                                   |                                 | L2    | Missing |                                         |          |         | #1150     | No generator at L1/L2; silent under-generation                         |
| REQ-027    | Anti-drift validator suite                             |                                 | L2    | Partial | src/generators/anti-drift-validators.ts |          |         |           | 19/20 scripts never reach targets (orphan) — see #1152                 |
| REQ-028    | Feature/RTM matrix (this document)                     |                                 | L2    | Partial | src/generators/feature-matrix.ts        |          |         |           | Track A + Track B generator; gate wired at L1                          |
| REQ-029    | AGENTS.md / GLOBAL_INVARIANTS parity gates             |                                 | L1    | Partial | scripts/check-catalog-agents-parity.mjs |          |         |           | Bidirectional parity; CANON-01..22 absent from AGENTS.md — see #1158   |
| REQ-030    | ADR SSOT gate                                          |                                 | L2    | Partial | scripts/check-adr-index.mjs             |          |         |           | INV-107; 11 ADRs extracted (077–087)                                   |
| REQ-031    | Pharma/21CFR overlay (industryOverlay)                 |                                 | L4    | Partial | src/generators/pharma.ts                |          |         |           | Java+industryOverlay=pharma only; generic L4 needed — see #1156        |
| REQ-032    | Frontend governance (FE constitution)                  |                                 | L2    | Partial | src/generators/frontend-governance.ts   |          |         |           | INV-102–106; DTCG tokens, Vitest browser, WCAG 2.2                     |
| REQ-033    | Kit experimental gate                                  |                                 | L2    | Missing |                                         |          |         | #1151     | Gate is fiction — not enforced against real kit state                  |
| REQ-034    | Observability / structured logging                     |                                 | L2    | Partial | src/generators/observability.ts         |          |         |           | OpenTelemetry + structured logging scaffolding                         |
| REQ-035    | Auth scaffold (JWT/session)                            |                                 | L2    | Partial | src/generators/auth.ts                  |          |         |           | Auth middleware templates; L2+                                         |
| REQ-036    | Behavioral testing (BDD / Cucumber)                    |                                 | L3    | Partial | src/generators/behavioral-tests.ts      |          |         |           | BDD scenario generation; @ignore tag hard-fail (INV-40)                |
| REQ-037    | Contract testing (Pact)                                |                                 | L3    | Partial | src/generators/contract-testing.ts      |          |         |           | Pact broker + schema registry gates (INV-41/42)                        |
| REQ-038    | Evidence retention & audit bundle                      |                                 | L4    | Partial | src/generators/evidence-retention.ts    |          |         |           | INV-90; evidence-bundle gate + retention policy                        |
| REQ-039    | SSOT core set / knowledge map                          |                                 | L2    | Partial | scripts/gen-ssot-core.mjs               |          |         |           | INV-108; ssot-core index generation + gate                             |
| REQ-040    | Worktree / task lifecycle                              |                                 | L1    | Partial | src/commands/worktree.ts                |          |         |           | Git worktree management + task evidence lifecycle                      |
| REQ-041    | Interactive wizard (arbiter init)                      |                                 | L1    | Partial | src/wizard/prompts.ts                   |          |         |           | Multi-step wizard; governance level UX gaps                            |
| REQ-042    | Doctor health check                                    |                                 | L1    | Partial | src/commands/doctor.ts                  |          |         |           | File-lock health + stale-lock detection (INV-72)                       |
| REQ-043    | Changeset / release tooling                            |                                 | L1    | Partial | src/commands/task.ts                    |          |         |           | arbiter task lifecycle + changeset integration                         |
| REQ-044    | Plugin system                                          |                                 | L2    | Partial | src/commands/plugin.ts                  |          |         |           | Plugin API stability gate (INV-55)                                     |
| REQ-045    | Self-validation / dogfood gate                         |                                 | L1    | Partial | scripts/check-self-dogfood.mjs          |          |         |           | INV-45; template↔self byte-parity for .claude/ files                   |
| REQ-046    | Local CI wrapper                                       |                                 | L2    | Partial | src/generators/local-wrapper.ts         |          |         |           | act-based local CI; parity gate                                        |
| REQ-047    | Infra / cloud templates                                |                                 | L2    | Partial | src/generators/infra.ts                 |          |         |           | Azure Container App; enableAzureContainerApp @deprecated               |
| REQ-048    | STRIDE / RACI governance                               |                                 | L2    | Partial | src/generators/stride-enforcement.ts    |          |         |           | STRIDE threat model + RACI matrix generated at L2+                     |
| REQ-049    | Risk register                                          |                                 | L3    | Partial | src/generators/risk-register.ts         |          |         |           | Risk register template generated at L3+                                |
| REQ-050    | Compliance mapping (ISO 27001 / GDPR)                  |                                 | L3    | Partial | src/generators/compliance.ts            |          |         |           | ISO 27001 Annex A + GDPR/NIS2 mapping templates                        |

<!-- FEATURE_MATRIX_END -->

---

## Summary

| Status    | Count  |
| --------- | ------ |
| Verified  | 0      |
| Done      | 0      |
| Partial   | 47     |
| Missing   | 3      |
| **Total** | **50** |

---

## Coverage

All 77 KIT dimensions (N01–N77) are tracked. Coverage breakdown by category:

| Category           | Dims         | Covered by       |
| ------------------ | ------------ | ---------------- |
| architecture       | N01–N07      | REQ-001, REQ-016 |
| audit_trail        | N08, N73–N75 | REQ-002          |
| static_analysis    | N09–N16      | REQ-003          |
| test_framework     | N17–N23      | REQ-004          |
| test_profiles      | N24–N26      | REQ-005          |
| test_types         | N27–N33      | REQ-006          |
| cicd               | N34–N40      | REQ-007          |
| e2e_perf           | N41–N44      | REQ-008          |
| scripts_validation | N45–N50      | REQ-009          |
| scripts_quality    | N51–N54      | REQ-010          |
| security           | N55–N58      | REQ-011          |
| git_github         | N59–N62      | REQ-012          |
| documentation      | N63–N68      | REQ-013          |
| configuration      | N69–N72      | REQ-014          |
| a11y               | N76          | REQ-015          |
| module_boundaries  | N77          | REQ-016          |

---

## Version history

| Version | Date       | Changes                                                              |
| ------- | ---------- | -------------------------------------------------------------------- |
| 1.0.0   | 2026-06-02 | Initial seeding from reconciliation audit; 50 rows, all dims covered |
