---
title: 'GAP — arbiter gap register'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product']
related: ['PRODUCT/FEATURE_MATRIX.md', 'PRODUCT/STATUS.md', 'INDEX.md']
---

# GAP — arbiter gap register

> Generated from FEATURE_MATRIX.md · constraint-scan · convergence reports.
> Refresh: `node scripts/gen-gap.mjs --write`. Gate: `node scripts/gen-gap.mjs --check`.

<!-- GAP_START -->

## v1 Blockers

| feature_id | capability            | status  | issue | notes                                                 |
| ---------- | --------------------- | ------- | ----- | ----------------------------------------------------- |
| REQ-033    | Kit experimental gate | Missing | #1151 | Gate is fiction — not enforced against real kit state |

## Feature Gaps

| feature_id | capability                                                                                             | status  | severity | blocks_v1 | issue | matrix                               |
| ---------- | ------------------------------------------------------------------------------------------------------ | ------- | -------- | --------- | ----- | ------------------------------------ |
| REQ-033    | Kit experimental gate                                                                                  | Missing | high     | yes       | #1151 | [REQ-033](FEATURE_MATRIX.md#req-033) |
| REQ-001    | Architecture enforcement (hexagonal / layered)                                                         | Partial | medium   | no        | #2244 | [REQ-001](FEATURE_MATRIX.md#req-001) |
| REQ-002    | Audit trail / 21CFR scaffold                                                                           | Partial | medium   | no        | #1156 | [REQ-002](FEATURE_MATRIX.md#req-002) |
| REQ-003    | Static analysis & linting                                                                              | Partial | medium   | no        | #2244 | [REQ-003](FEATURE_MATRIX.md#req-003) |
| REQ-004    | Test framework wiring                                                                                  | Partial | medium   | no        | #2244 | [REQ-004](FEATURE_MATRIX.md#req-004) |
| REQ-005    | Test profiles & TDD evidence                                                                           | Partial | medium   | no        | #2244 | [REQ-005](FEATURE_MATRIX.md#req-005) |
| REQ-006    | Integration / mutation / behavioral / contract testing                                                 | Partial | medium   | no        | #2244 | [REQ-006](FEATURE_MATRIX.md#req-006) |
| REQ-007    | CI/CD pipeline & workflow runners                                                                      | Partial | medium   | no        | #2244 | [REQ-007](FEATURE_MATRIX.md#req-007) |
| REQ-008    | E2E & performance testing                                                                              | Partial | medium   | no        | #2244 | [REQ-008](FEATURE_MATRIX.md#req-008) |
| REQ-009    | Gate script validation                                                                                 | Partial | medium   | no        | #2244 | [REQ-009](FEATURE_MATRIX.md#req-009) |
| REQ-010    | Quality gate scripts                                                                                   | Partial | medium   | no        | #2244 | [REQ-010](FEATURE_MATRIX.md#req-010) |
| REQ-011    | Security toolchain                                                                                     | Partial | medium   | no        | #2244 | [REQ-011](FEATURE_MATRIX.md#req-011) |
| REQ-012    | Git/GitHub governance                                                                                  | Partial | medium   | no        | #2247 | [REQ-012](FEATURE_MATRIX.md#req-012) |
| REQ-013    | Documentation generation                                                                               | Partial | medium   | no        | #2247 | [REQ-013](FEATURE_MATRIX.md#req-013) |
| REQ-014    | Project configuration surface                                                                          | Partial | medium   | no        | #1145 | [REQ-014](FEATURE_MATRIX.md#req-014) |
| REQ-016    | Module boundary enforcement                                                                            | Partial | medium   | no        | #2244 | [REQ-016](FEATURE_MATRIX.md#req-016) |
| REQ-017    | CLI command surface (count: see src/cli.ts `.command(...)` registrations)                              | Partial | medium   | no        | #2246 | [REQ-017](FEATURE_MATRIX.md#req-017) |
| REQ-018    | Generator scaffold (count: see .bloat-baseline.json → buckets.generators / src/generators/registry.ts) | Partial | medium   | no        | #2246 | [REQ-018](FEATURE_MATRIX.md#req-018) |
| REQ-019    | Invariant catalog & AGENTS.md parity (count: see src/invariants/catalog.ts)                            | Partial | medium   | no        | #2246 | [REQ-019](FEATURE_MATRIX.md#req-019) |
| REQ-020    | Governance level dial (L1–L4)                                                                          | Partial | medium   | no        | #2246 | [REQ-020](FEATURE_MATRIX.md#req-020) |
| REQ-021    | TypeScript stack support                                                                               | Partial | medium   | no        | #2245 | [REQ-021](FEATURE_MATRIX.md#req-021) |
| REQ-022    | Java stack support                                                                                     | Partial | medium   | no        | #2245 | [REQ-022](FEATURE_MATRIX.md#req-022) |
| REQ-023    | Python stack support                                                                                   | Partial | medium   | no        | #2245 | [REQ-023](FEATURE_MATRIX.md#req-023) |
| REQ-024    | Go stack support                                                                                       | Partial | medium   | no        | #2245 | [REQ-024](FEATURE_MATRIX.md#req-024) |
| REQ-025    | Rust stack support                                                                                     | Partial | medium   | no        | #2245 | [REQ-025](FEATURE_MATRIX.md#req-025) |
| REQ-027    | Anti-drift validator suite                                                                             | Partial | medium   | no        | #1152 | [REQ-027](FEATURE_MATRIX.md#req-027) |
| REQ-029    | AGENTS.md / GLOBAL_INVARIANTS parity gates                                                             | Partial | medium   | no        | #1158 | [REQ-029](FEATURE_MATRIX.md#req-029) |
| REQ-030    | ADR SSOT gate                                                                                          | Partial | medium   | no        | #2246 | [REQ-030](FEATURE_MATRIX.md#req-030) |
| REQ-031    | Pharma/21CFR overlay (industryOverlay)                                                                 | Partial | medium   | no        | #1156 | [REQ-031](FEATURE_MATRIX.md#req-031) |
| REQ-032    | Frontend governance (FE constitution)                                                                  | Partial | medium   | no        | #2244 | [REQ-032](FEATURE_MATRIX.md#req-032) |
| REQ-034    | Observability / structured logging                                                                     | Partial | medium   | no        | #2247 | [REQ-034](FEATURE_MATRIX.md#req-034) |
| REQ-035    | Auth scaffold (JWT/session)                                                                            | Partial | medium   | no        | #2247 | [REQ-035](FEATURE_MATRIX.md#req-035) |
| REQ-036    | Behavioral testing (BDD / Cucumber)                                                                    | Partial | medium   | no        | #2244 | [REQ-036](FEATURE_MATRIX.md#req-036) |
| REQ-037    | Contract testing (Pact)                                                                                | Partial | medium   | no        | #2244 | [REQ-037](FEATURE_MATRIX.md#req-037) |
| REQ-038    | Evidence retention & audit bundle                                                                      | Partial | medium   | no        | #2244 | [REQ-038](FEATURE_MATRIX.md#req-038) |
| REQ-039    | SSOT core set / knowledge map                                                                          | Partial | medium   | no        | #2246 | [REQ-039](FEATURE_MATRIX.md#req-039) |
| REQ-040    | Worktree / task lifecycle                                                                              | Partial | medium   | no        | #2246 | [REQ-040](FEATURE_MATRIX.md#req-040) |
| REQ-042    | Doctor health check                                                                                    | Partial | medium   | no        | #2246 | [REQ-042](FEATURE_MATRIX.md#req-042) |
| REQ-043    | Changeset / release tooling                                                                            | Partial | medium   | no        | #2246 | [REQ-043](FEATURE_MATRIX.md#req-043) |
| REQ-044    | Plugin system                                                                                          | Partial | medium   | no        | #2246 | [REQ-044](FEATURE_MATRIX.md#req-044) |
| REQ-045    | Self-validation / dogfood gate                                                                         | Partial | medium   | no        | #2244 | [REQ-045](FEATURE_MATRIX.md#req-045) |
| REQ-046    | Local CI wrapper                                                                                       | Partial | medium   | no        | #2244 | [REQ-046](FEATURE_MATRIX.md#req-046) |
| REQ-047    | Infra / cloud templates                                                                                | Partial | medium   | no        | #2247 | [REQ-047](FEATURE_MATRIX.md#req-047) |
| REQ-048    | STRIDE / RACI governance                                                                               | Partial | medium   | no        | #2247 | [REQ-048](FEATURE_MATRIX.md#req-048) |
| REQ-049    | Risk register                                                                                          | Partial | medium   | no        | #2247 | [REQ-049](FEATURE_MATRIX.md#req-049) |
| REQ-050    | Compliance mapping (ISO 27001 / GDPR)                                                                  | Partial | medium   | no        | #2247 | [REQ-050](FEATURE_MATRIX.md#req-050) |
| REQ-054    | LLM-Wiki generator + lint gate (Karpathy pattern, #1241)                                               | Partial | medium   | no        | #1241 | [REQ-054](FEATURE_MATRIX.md#req-054) |

## Enforcement Gaps

| constraint                      | location | severity |
| ------------------------------- | -------- | -------- |
| _No unenforceable constraints._ |

## Known Debt

| issue | title           | status | severity |
| ----- | --------------- | ------ | -------- |
| #1160 | Tech debt #1160 | Open   | low      |
| #1161 | Tech debt #1161 | Open   | low      |
| #1177 | Tech debt #1177 | Open   | low      |
| #1208 | Tech debt #1208 | Open   | low      |
| #1215 | Tech debt #1215 | Open   | low      |
| #1222 | Tech debt #1222 | Open   | low      |
| #1723 | Tech debt #1723 | Open   | low      |
| #1724 | Tech debt #1724 | Open   | low      |
| #1725 | Tech debt #1725 | Open   | low      |
| #2391 | Tech debt #2391 | Open   | low      |
| #2388 | Tech debt #2388 | Open   | low      |
| #1735 | Tech debt #1735 | Open   | low      |
| #1736 | Tech debt #1736 | Open   | low      |
| #1740 | Tech debt #1740 | Open   | low      |
| #1752 | Tech debt #1752 | Open   | low      |
| #1753 | Tech debt #1753 | Open   | low      |
| #1763 | Tech debt #1763 | Open   | low      |
| #1775 | Tech debt #1775 | Open   | low      |
| #1777 | Tech debt #1777 | Open   | low      |
| #1778 | Tech debt #1778 | Open   | low      |
| #1779 | Tech debt #1779 | Open   | low      |
| #1780 | Tech debt #1780 | Open   | low      |
| #1781 | Tech debt #1781 | Open   | low      |
| #1782 | Tech debt #1782 | Open   | low      |
| #1783 | Tech debt #1783 | Open   | low      |
| #1784 | Tech debt #1784 | Open   | low      |
| #1809 | Tech debt #1809 | Open   | low      |

<!-- GAP_END -->
