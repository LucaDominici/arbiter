---
title: 'FEATURE_MATRIX — Product Truth RTM'
doc_version: '1.1.0'
status: active
last_review: '2026-08-08'
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
> **Export:** (planned) CSV/XLSX export for PM/stakeholder views — not yet shipped as a CLI command.

---

## Status vocabulary

| Status     | Meaning                              | Required fields                                               |
| ---------- | ------------------------------------ | ------------------------------------------------------------- |
| `Missing`  | No implementation — tracked by issue | `issue_ref` in `#NNN` format                                  |
| `Partial`  | Code exists; test/doc incomplete     | `code_ref` non-empty                                          |
| `Done`     | Code + test + doc all present        | `code_ref` + `test_ref` + `doc_ref` non-empty and files exist |
| `Verified` | Full evidence chain — gate-checked   | all four refs non-empty, `test_ref` title parsed              |

Promotion is fail-closed (cannot skip a step).

`source_ref` (optional, 11th column, #2163): upward anchor(s) toward the
requirement's origin (`INV-NN`, `ADR-NNN`, `PRD §N(.M)*`, comma-separated).
Validated whenever non-empty, regardless of status — a stale anchor is a
defect on a `Partial` row too, not just a promotion-gated one. Non-canonical
forms (an issue reference, free prose, a legacy-declared anchor) are
format-only and never resolved (no false red). `test_ref` glob patterns
(`*`/`**`) are additionally banned on `Done`/`Verified` rows unless
grandfathered in the committed ratchet baseline
(`scripts/data/feature-matrix-glob-baseline.json`, regenerated deliberately
via `--update-baseline`); a `Verified` row is never baseline-exemptible.

---

## Verification tier

`verification_tier` (optional, 12th column, #2242): the KIND of proof a requirement
needs to be fully qualified, mapped from GAMP's IQ/OQ/PQ onto arbiter's own real
3-tier V&V. **It is independent of `status`** — a `Partial` or `Missing` row can
correctly declare `E2E` when the qualifying test is a functional-tier run that does
not exist yet, exactly as it can declare `SCAFFOLD` or `GATE`. Read tier and status
together as the real triage signal: `Partial`+`E2E` is a materially more expensive
gap to close than `Partial`+`GATE`.

| Tier       | GAMP mapping     | Qualified when…                                                              | Evidence directory                                                                                    |
| ---------- | ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SCAFFOLD` | IQ (installation) | `arbiter init`/`update` demonstrably produces the expected artifact(s)       | a bake-tier structure snapshot (`__tests__/integration/e2e/bake/`) or a real-project fixture (`__tests__/fixtures/real-projects/`) |
| `GATE`     | OQ (operational)  | Arbiter's own logic is correct — verified directly, no target-project run needed | arbiter's own L1/L2 unit + integration suite (any `__tests__/**` test outside bake/functional)                       |
| `E2E`      | PQ (performance)  | The *generated* enforcement mechanism actually works when run for real (e.g. a seeded violation REDs the generated gate) | functional-tier run of the generated project's own gate (`__tests__/integration/e2e/functional/`, e.g. `greenfield-first-run.test.ts`) |

Assignment rule used to seed this column (#2242): a row whose `test_ref` names a
file in one of the evidence directories above takes that directory's tier
directly. All 10 rows with a cited `test_ref` land under `GATE`: none cites a
bake- or functional-tier test, so none reaches `SCAFFOLD` or `E2E` evidence. A row with no
`test_ref` (45 rows) declares the tier its capability *requires*: stack/language
support → `SCAFFOLD` (INV-32 anchors verification to a real-project fixture per
language); arbiter-internal mechanisms with no target-project dependency (CLI
surface, generator registry, invariant catalog, SSOT/parity gates, wizard,
worktree/task lifecycle, doctor, plugin system) → `GATE`; artifact/template-only
generators with no runtime enforcement claim → `SCAFFOLD`; governance/enforcement
mechanisms wired into a target's own `check-all.mjs` (whose correctness is only
provable by actually running that gate) → `E2E`. `check-feature-matrix.mjs`
validates the cell is one of `SCAFFOLD|GATE|E2E` whenever non-empty; it does not
(yet) enforce that every row carries a value, matching the optional-trailing-column
posture already established for `source_ref`.

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

| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note | source_ref | verification_tier |
| ---------- | ---------------------------------------------------------------- | ------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ |
| REQ-001 | Architecture enforcement (hexagonal / layered) | N01,N02,N03,N04,N05,N06,N07 | L2 | Partial | src/generators/boundaries.ts |  |  | #2244 | ArchUnit (Java) + ESLint boundaries (TS); cross-stack coverage partial |  | E2E |
| REQ-002 | Audit trail / 21CFR scaffold | N08,N73,N74,N75 | L4 | Partial | src/generators/pharma.ts |  |  | #1156 | pharma overlay = Java JPA/ArchUnit (KIT N73-75); sox/gdpr/generic overlays = language-neutral L4 audit-trail policy + gate rules under docs/compliance/, decoupled from the pharma Java scaffolding (#1156, src/templates/audit/generic/) |  | E2E |
| REQ-003 | Static analysis & linting | N09,N10,N11,N12,N13,N14,N15,N16 | L2 | Partial | src/generators/quality.ts |  |  | #2244 | ESLint + tsc; complexity + coverage gates wired |  | E2E |
| REQ-004 | Test framework wiring | N17,N18,N19,N20,N21,N22,N23 | L2 | Partial | src/generators/quality.ts |  |  | #2244 | Vitest (TS), JUnit 5 (Java), pytest (Python), go test, cargo test |  | E2E |
| REQ-005 | Test profiles & TDD evidence | N24,N25,N26 | L2 | Partial | src/generators/evidence-retention.ts |  |  | #2244 | Coverage thresholds + TDD evidence gate wired at L2+ |  | E2E |
| REQ-006 | Integration / mutation / behavioral / contract testing | N27,N28,N29,N30,N31,N32,N33 | L2 | Partial | src/generators/integration-testing.ts |  |  | #2244 | Mutation (Java L2+), BDD, contract testing all behind L2+ gates |  | E2E |
| REQ-007 | CI/CD pipeline & workflow runners | N34,N35,N36,N37,N38,N39,N40 | L2 | Partial | src/generators/github.ts |  |  | #2244 | GH Actions workflows generated; workflow-runner gate wired |  | E2E |
| REQ-008 | E2E & performance testing | N41,N42,N43,N44 | L2 | Partial | src/generators/playwright-ts.ts |  |  | #2244 | Playwright (TS/Python) + k6 perf; archetype-gated |  | E2E |
| REQ-009 | Gate script validation | N45,N46,N47,N48,N49,N50 | L2 | Partial | src/generators/check-all.ts |  |  | #2244 | check-all.mjs generated + wired; 29 gates wired-but-untested (GAP) |  | E2E |
| REQ-010 | Quality gate scripts | N51,N52,N53,N54 | L2 | Partial | src/generators/debt-gates.ts |  |  | #2244 | Debt ratchet, duplication, bloat, dead-code gates generated |  | E2E |
| REQ-011 | Security toolchain | N55,N56,N57,N58 | L2 | Partial | src/generators/security.ts |  |  | #2244 | Gitleaks, npm audit, STRIDE enforcement; SAST level-gated |  | E2E |
| REQ-012 | Git/GitHub governance | N59,N60,N61,N62 | L2 | Partial | src/generators/github-setup.ts |  |  | #2247 | Branch protection, label defs, Actions pins; all L2+ |  | SCAFFOLD |
| REQ-013 | Documentation generation | N63,N64,N65,N66,N67,N68 | L2 | Partial | src/generators/docs.ts |  |  | #2247 | MASTER_TEST_PLAN, CODING_STANDARDS, ADR template, COMMANDS.md |  | SCAFFOLD |
| REQ-014 | Project configuration surface | N69,N70,N71,N72 | L1 | Partial | src/wizard/types.ts |  |  | #1145 | arbiter.json schema; strictnessTier live (noUncheckedIndexedAccess TS + pedantic Rust); deprecated enableDeployWorkflows/enableAzureContainerApp removed (#1145/#1146) → deployTarget is the single deploy gate; databaseEngine still consumed by KIT applicability (N08/N73/N74/N75), @deprecated pending auto-detection (#1058); StackAdapter registry test-only (#1157) |  | GATE |
| REQ-015 | Accessibility (a11y) enforcement | N76 | L2 | Done | src/generators/playwright-ts.ts,src/generators/playwright-python.ts | __tests__/generators/playwright-ts.test.ts,__tests__/generators/playwright-python.test.ts | docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md |  | axe-playwright-python (Python, beta) + @axe-core/playwright (TS, proven); archetype-gated (frontend-spa, backend-web-db) |  | GATE |
| REQ-016 | Module boundary enforcement | N77 | L2 | Partial | src/generators/boundaries.ts |  |  | #2244 | ESLint-import-boundaries (TS); cross-stack not fully covered |  | E2E |
| REQ-017 | CLI command surface (count: see src/cli.ts `.command(...)` registrations) |  | L1 | Partial | src/cli.ts |  |  | #2246 | Count is SSOT at src/cli.ts (do not hand-copy); public vs hidden (`{ hidden: true }`) split enumerable via `arbiter help --all`; CLI ref at website/reference/cli.md |  | GATE |
| REQ-018 | Generator scaffold (count: see .bloat-baseline.json → buckets.generators / src/generators/registry.ts) |  | L1 | Partial | src/generators/registry.ts |  |  | #2246 | Count is SSOT at .bloat-baseline.json (regenerated via scripts/capture-debt-baseline.mjs), registration at src/generators/registry.ts; anti-drift-validators no longer orphan — see REQ-027 (#1152, wired + emission↔wiring locked by test) |  | GATE |
| REQ-019 | Invariant catalog & AGENTS.md parity (count: see src/invariants/catalog.ts) |  | L1 | Partial | src/invariants/catalog.ts |  |  | #2246 | Count is SSOT at src/invariants/catalog.ts (do not hand-copy); catalog↔AGENTS parity gate wired (INV-110) |  | GATE |
| REQ-020 | Governance level dial (L1–L4) |  | L1 | Partial | src/wizard/types.ts |  |  | #2246 | L1–L4 graduated enforcement; minGovernanceLevel filter wired |  | GATE |
| REQ-021 | TypeScript stack support |  | L1 | Partial | src/generators/boundaries.ts |  |  | #2245 | Architecture + quality + security + testing fully generated |  | SCAFFOLD |
| REQ-022 | Java stack support |  | L1 | Partial | src/generators/archunit.ts |  |  | #2245 | ArchUnit, JUnit 5, mutation (PIT), pharma overlay |  | SCAFFOLD |
| REQ-023 | Python stack support |  | L2 | Partial | src/generators/playwright-python.ts |  |  | #2245 | L3+ loud per matrix; core generators beta |  | SCAFFOLD |
| REQ-024 | Go stack support |  | L2 | Partial | src/generators/go-boundaries.ts |  |  | #2245 | L3+ loud; go-boundaries + go test wired |  | SCAFFOLD |
| REQ-025 | Rust stack support |  | L2 | Partial | src/generators/rust-boundaries.ts |  |  | #2245 | L3+ loud; cargo test + clippy wired |  | SCAFFOLD |
| REQ-026 | Kotlin stack support |  | L2 | Verified | src/generators/quality.ts, src/generators/modulith.ts, src/generators/debt-gates.ts, src/generators/coverage.ts, src/generators/archunit.ts | __tests__/generators/kotlin-beta.test.ts | docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md | #1177 | #1177: Real kotlin generation — detekt (config/detekt/detekt.yml), kover (kover.gradle, 0.9.x API), sonar kotlin branch (src/main/kotlin + build/reports/kover/report.xml), ArchUnit extended to kotlin. Content-asserting tests (not smoke) at the generator-unit layer. INV-32 fixture at __tests__/fixtures/real-projects/kotlin-backend-web-db-gradle/ is `tier: snapshot` (manifest validation only — no `arbiter init`, no generated-gate exec; #1840 F4 tranche-2 decision, 2026-07-09: declassified to snapshot-only pre-publish, excluded from the Generator Matrix workflow). Matrix cells stay beta (not promoted to proven). Re-promotion blocker #1803 (3/8 workflow dims — fuzz/license_scan/sbom — relied on unverified JVM-shared EJS branches) CLOSED — all 3 dims now share the java/JVM branch with an explicit kotlin arm + render tests (fuzz landed first; license_scan + sbom landed together). Remaining follow-up: #1194 (kotlin gate wiring in check-all.mjs.ejs). |  | GATE |
| REQ-027 | Anti-drift validator suite |  | L2 | Partial | src/generators/anti-drift-validators.ts | __tests__/generators/anti-drift-validators.test.ts |  | #1152 | #1152: emits 18 validators (was 20) — dropped check-pii-scan (dup of native pii-scan) + check-tier-coverage (arbiter-self meta-gate); all 18 now wired into the generated target check-all under correct conditionals (matrix-verified TS/py/java); emission↔wiring locked by test |  | GATE |
| REQ-028 | Feature/RTM matrix (this document) |  | L2 | Verified | src/generators/feature-matrix.ts | __tests__/generators/feature-matrix.test.ts | docs/internal/PRODUCT/FEATURE_MATRIX.md | #1159 | Track A + Track B generator; gate wired at L1. Originating PR #1159 (INV-112, CANON-23); stale #1112 ref in prior note was an unrelated docs fix. |  | GATE |
| REQ-029 | AGENTS.md / GLOBAL_INVARIANTS parity gates |  | L1 | Partial | scripts/check-catalog-agents-parity.mjs |  |  | #1158 | Bidirectional parity; CANON-01..22 absent from AGENTS.md — see #1158 |  | GATE |
| REQ-030 | ADR SSOT gate |  | L2 | Partial | scripts/check-adr-index.mjs |  |  | #2246 | INV-107; 11 ADRs extracted (077–087) |  | GATE |
| REQ-031 | Pharma/21CFR overlay (industryOverlay) |  | L4 | Partial | src/generators/pharma.ts |  |  | #1156 | Java+industryOverlay=pharma only; generic L4 needed — see #1156 |  | E2E |
| REQ-032 | Frontend governance (FE constitution) |  | L2 | Partial | src/generators/frontend-governance.ts |  |  | #2244 | INV-102–106; DTCG tokens, Vitest browser, WCAG 2.2 |  | E2E |
| REQ-033 | Kit experimental gate |  | L2 | Missing |  |  |  | #1151 | Gate is fiction — not enforced against real kit state |  | E2E |
| REQ-034 | Observability / structured logging |  | L2 | Partial | src/generators/observability.ts |  |  | #2247 | OpenTelemetry + structured logging scaffolding |  | SCAFFOLD |
| REQ-035 | Auth scaffold (JWT/session) |  | L2 | Partial | src/generators/auth.ts |  |  | #2247 | Auth middleware templates; L2+ |  | SCAFFOLD |
| REQ-036 | Behavioral testing (BDD / Cucumber) |  | L3 | Partial | src/generators/behavioral-tests.ts |  |  | #2244 | BDD scenario generation; @ignore tag hard-fail (INV-40) |  | E2E |
| REQ-037 | Contract testing (Pact) |  | L3 | Partial | src/generators/contract-testing.ts |  |  | #2244 | Pact broker + schema registry gates (INV-41/42) |  | E2E |
| REQ-038 | Evidence retention & audit bundle |  | L4 | Partial | src/generators/evidence-retention.ts |  |  | #2244 | INV-90; evidence-bundle gate + retention policy |  | E2E |
| REQ-039 | SSOT core set / knowledge map |  | L2 | Partial | scripts/gen-ssot-core.mjs |  |  | #2246 | INV-108; ssot-core index generation + gate |  | GATE |
| REQ-040 | Worktree / task lifecycle |  | L1 | Partial | src/commands/worktree.ts |  |  | #2246 | Git worktree management + task evidence lifecycle |  | GATE |
| REQ-041 | Interactive wizard (arbiter init) |  | L1 | Verified | src/wizard/prompts.ts | __tests__/wizard/prompts.test.ts | website/reference/cli.md | #1168 | Multi-step wizard; governance level UX gaps. clack prompts mocked in tests: answer→config logic and abort semantics verified, not TUI rendering (accepted Verified bar). |  | GATE |
| REQ-042 | Doctor health check |  | L1 | Partial | src/commands/doctor.ts |  |  | #2246 | File-lock health + stale-lock detection (INV-72) |  | GATE |
| REQ-043 | Changeset / release tooling |  | L1 | Partial | src/commands/task.ts |  |  | #2246 | arbiter task lifecycle + changeset integration |  | GATE |
| REQ-044 | Plugin system |  | L2 | Partial | src/commands/plugin.ts |  |  | #2246 | Plugin API stability gate (INV-55) |  | GATE |
| REQ-045 | Self-validation / dogfood gate |  | L1 | Partial | scripts/check-self-dogfood.mjs |  |  | #2244 | INV-45; template↔self byte-parity for .claude/ files |  | E2E |
| REQ-046 | Local CI wrapper |  | L2 | Partial | src/generators/local-wrapper.ts |  |  | #2244 | act-based local CI; parity gate |  | E2E |
| REQ-047 | Infra / cloud templates |  | L2 | Partial | src/generators/infra.ts |  |  | #2247 | Azure Container App; enableAzureContainerApp @deprecated |  | SCAFFOLD |
| REQ-048 | STRIDE / RACI governance |  | L2 | Partial | src/generators/stride-enforcement.ts |  |  | #2247 | STRIDE threat model + RACI matrix generated at L2+ |  | SCAFFOLD |
| REQ-049 | Risk register |  | L3 | Partial | src/generators/risk-register.ts |  |  | #2247 | Risk register template generated at L3+ |  | SCAFFOLD |
| REQ-050 | Compliance mapping (ISO 27001 / GDPR) |  | L3 | Partial | src/generators/compliance.ts |  |  | #2247 | ISO 27001 Annex A + GDPR/NIS2 mapping templates |  | SCAFFOLD |
| REQ-051 | Resilience patterns (circuit-breaker/retry/rate-limiter/timeout) | N78 | L2 | Done | src/generators/resilience.ts,src/templates/resilience/RESILIENCE.md.ejs | __tests__/generators/resilience.test.ts,__tests__/templates/resilience-md-ejs.test.ts,__tests__/brownfield/resilience-brownfield.test.ts | docs/REFERENCE/RESILIENCE.md | #1176 | Advisory guide: CB+retry+rate-limiter+timeout defaults + external-call checklist; ts (cockatiel) + java (Resilience4j) concrete blocks; multi emits both; L3/L4 enforcement addendum |  | GATE |
| REQ-052 | Living STATUS dashboard (generated, drift-proof) |  | L1 | Done | scripts/gen-status.mjs | __tests__/scripts/gen-status.test.ts | docs/internal/PRODUCT/STATUS.md |  | Drift-proof STATUS.md generated from FEATURE_MATRIX + MILESTONES + PRD; --check gate wired in check-all L1; mirrors gen-doc-index harness |  | GATE |
| REQ-053 | /ship orchestration synthesis (single narrative, #1216) |  | L1 | Verified | src/commands/task-ship.ts | __tests__/templates/commands-claude.test.ts | .claude/commands/ship.md | #1216 | /ship is the sole orchestration entrypoint; /task = low-level engine/CLI reference; dual-sided dogfood parity; FEATURE_MATRIX + ADR-088 |  | GATE |
| REQ-054 | LLM-Wiki generator + lint gate (Karpathy pattern, #1241) |  | L2 | Partial | scripts/gen-wiki.mjs,scripts/check-wiki-lint.mjs,src/generators/wiki.ts | __tests__/gates/wiki-lint-fixture.test.ts,__tests__/generators/wiki.test.ts,__tests__/templates/wiki-gen-render.test.ts | docs/ADR/089-collapse-hand-docs-to-ssot-core-plus-generated-wiki.md | #1241 | Static compiler: docs/ → wiki/ (Obsidian md + wikilinks + citations); 4-dimension lint gate (broken-link, orphan, stale, citation); on-commit incremental hook; dual-sided; INV-116 |  | GATE |
| REQ-055 | Companion-plugin awareness in /ship (ponytail, #1730) |  | L2 | Done | src/integrations/companions.ts,src/commands/ship-profile.ts | __tests__/integrations/companions.test.ts,__tests__/commands/task-ship.test.ts | docs/internal/ADR/100-companion-plugin-awareness.md | #1730 | HOME-only detection; composes green phase on product repos; never arbiter-self; lite\|full only; absent ⇒ byte-identical |  | GATE |

<!-- FEATURE_MATRIX_END -->

---

## Summary

| Status | Count |
|---|---|
| Verified | 4 |
| Done | 4 |
| Partial | 46 |
| Missing | 1 |
| **Total** | **55** |

---

## Verification Tier Distribution

> Hand-maintained (not regenerated by `--write`, unlike `## Summary` above) — refresh
> alongside the table whenever a row's `verification_tier` changes.

| Tier       | Count | Rows                                                                                            |
| ---------- | ----- | ------------------------------------------------------------------------------------------------- |
| `SCAFFOLD` | 13    | REQ-012, REQ-013, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-034, REQ-035, REQ-047, REQ-048, REQ-049, REQ-050 |
| `GATE`     | 22    | REQ-014, REQ-015, REQ-017, REQ-018, REQ-019, REQ-020, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-051, REQ-052, REQ-053, REQ-054, REQ-055 |
| `E2E`      | 20    | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-016, REQ-031, REQ-032, REQ-033, REQ-036, REQ-037, REQ-038, REQ-045, REQ-046 |
| **Total**  | **55**| |

Of the 10 rows whose `test_ref` is already populated (the Done/Verified rows plus
REQ-027/REQ-054), all 10 currently land under `GATE` — none of this repo's own cited
tests are bake-tier or functional-tier yet. The 20 `E2E`-required rows are
correspondingly the highest-value gap: each is a governance/enforcement mechanism
CANON-23 exists to hold accountable, with zero test evidence at any tier today (see
Gap Triage below).

---

## Coverage

All 78 KIT dimensions (N01–N78) are tracked. Coverage breakdown by category:

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
| resilience         | N78          | REQ-051          |

---

## Gap Triage (#2242)

Every `Partial` (46) and `Missing` (1) row classified `true-gap` vs
`accepted-partial`, clustered by theme. Classifier (applied at triage time,
before this change landed): a row already carrying a pre-existing `issue_ref`
had its gap tracked — `accepted-partial`. A row with no `issue_ref` was an
untracked gap — the `40/46` set `check-feature-matrix.mjs`'s
governance-visibility WARN (rule 6) flagged at that moment. This triage
clustered that machine-derived list by theme and filed one follow-up per
cluster rather than 40 individual ones; writing those cluster refs into the
table closed the WARN, so rule 6 now reports `0/46` and the classifier is no
longer re-derivable from the table alone.

### Accepted-partial (7 rows) — already tracked

| feature_id | capability                                  | issue_ref | why accepted                                                             |
| ---------- | -------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| REQ-002    | Audit trail / 21CFR scaffold                 | #1156     | generic L4 audit-trail overlay is the open half of this gap, already scoped |
| REQ-014    | Project configuration surface                | #1145     | `databaseEngine` auto-detection is the open half, already scoped          |
| REQ-027    | Anti-drift validator suite                   | #1152     | tracked; validator set + wiring already reconciled in the linked issue    |
| REQ-029    | AGENTS.md / GLOBAL_INVARIANTS parity gates   | #1158     | CANON-01..22 AGENTS.md sync is the open half, already scoped              |
| REQ-031    | Pharma/21CFR overlay (industryOverlay)       | #1156     | same overlay-generalization gap as REQ-002, one tracking issue            |
| REQ-033    | Kit experimental gate (`Missing`)            | #1151     | already tracked; "gate is fiction" is the issue's own stated scope        |
| REQ-054    | LLM-Wiki generator + lint gate               | #1241     | tracked; this row's evidence chain is mid-build under the linked issue    |

### True-gap clusters (40 rows, 4 clusters) — new follow-up filed per cluster

**Cluster 1 — Core governance/enforcement generators lack cited E2E test_ref**
(17 rows, `E2E` tier, CANON-23-critical) → **#2244**
REQ-001, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009,
REQ-010, REQ-011, REQ-016, REQ-032, REQ-036, REQ-037, REQ-038, REQ-045,
REQ-046

**Cluster 2 — Stack-support rows lack a dedicated real-project fixture
test_ref** (5 rows, `SCAFFOLD` tier, asymmetric with Kotlin/REQ-026) →
**#2245**
REQ-021, REQ-022, REQ-023, REQ-024, REQ-025

**Cluster 3 — Arbiter-internal meta-capability rows lack cited test_ref**
(10 rows, `GATE` tier) → **#2246**
REQ-017, REQ-018, REQ-019, REQ-020, REQ-030, REQ-039, REQ-040, REQ-042,
REQ-043, REQ-044

**Cluster 4 — Artifact/template-only scaffold rows lack cited test_ref**
(8 rows, `SCAFFOLD` tier, low enforcement risk) → **#2247**
REQ-012, REQ-013, REQ-034, REQ-035, REQ-047, REQ-048, REQ-049, REQ-050

---

## Version history

| Version | Date       | Changes                                                              |
| ------- | ---------- | -------------------------------------------------------------------- |
| 1.0.0   | 2026-06-02 | Initial seeding from reconciliation audit; 51 rows, all dims covered |
| 1.1.0   | 2026-08-08 | #2242: GAMP-style enhancement — `verification_tier` column (SCAFFOLD\|GATE\|E2E) added to all 55 rows; REQ-017/018/019 stale hand-copied counts refreshed as SSOT pointers; gap triage of 46 Partial + 1 Missing rows (7 accepted-partial, 40 true-gap across 4 filed clusters: #2244–#2247) |
