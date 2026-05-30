---
title: 'Architectural Decision Records'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# Architectural Decision Records

This file documents architectural decisions made in the Arbiter project.
Individual ADR files also live in `docs/ADR/` for historical records.

---

## ADR-050: Pipeline Complexity Tiers — Archetype-Default + Governance Floor (#1004, 2026-05-23)

**Status:** Accepted
**Reference:** Issue #1004; full spec at `docs/ADR/050-pipeline-complexity-tiers.md`

**Context:** arbiter emitted one maximal 10+ workflow system for all archetypes and governance levels. Thresholds differed but pipeline shape was constant. A lib project at L1 should not receive the same cosign + k6 setup as a regulated service at L4.

**Decision:** Pipeline shape derives from project archetype (primary axis). `lib` and `cli` get PR gate + release only. `service`, `batch`, and `serverless` get the full deploy pipeline. Governance level enforces hard minimums: L3 adds nightly + heartbeat to all archetypes; L4 adds `03-human-approval.yml` (INV-74 mandatory) + cosign + SBOM + evidence files. These are invariants, not suggestions.

**Consequences:** Template count stays at 11 workflow files (governance differences as EJS guards per CANON-13). Generator must gate on both `archetype` and `governanceLevel`. Supersedes the prior "tier set constant, only thresholds vary" framing in `CI-TIER-MODEL.md §Context`.

---

## ADR-045: KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract (#878, 2026-05-19)

**Status:** Accepted
**Reference:** Issue #878 (W2 KIT Canonical SSOT), #875 (planning skeleton migration umbrella)

**Context:** W2 of the planning-skeleton migration promotes `src/kit/catalog.json` (W1 SSOT) to an enforced state with a typed access layer, a `validate` subcommand, and an L1 parity gate (INV-86). Two sources of truth exist during migration: the catalog (76 typed dimensions, N01..N76) and the mapping (`docs/audits/kit-canonical-mapping.json`). These must stay synchronized.

**Decision:**

- **Wrap-Not-Replace**: `src/kit/catalog.ts` is a typed access layer over `catalog.json`. JSON remains the SSOT; scripts can read it without importing TypeScript.
- **Authority hierarchy**: `src/kit/catalog.json` is parity authority; mapping conforms to catalog, not reverse.
- **Field cross-walk (INV-86)**: `id`/`canonical_id` (exact); `name`/`name` (NFC+trim); `tml`/`tml_source` (exact); `gate`/`gate_type` (strip `\s*\([^)]+\)$` suffix from mapping then exact-compare).
- **Enforcement coverage**: BLOCKING dims require invariant/validator/template/generator artifact, or `disposition===done`, or `disposition∈{adopt-framework,stack-adapter}` with `implementing_wave∈{W3..W11}`. F-prefixed waves and null rejected.
- **Redaction rule**: Neither catalog nor mapping may contain tokens from `scripts/data/redaction-lexicon.json`.
- **Generator output**: `docs/REFERENCE/dim-NN-<slug>.md` × 76 + `docs/REFERENCE/GLOBAL_KIT.md`. Brownfield-safe via SHA-256 hash marker on first line; `--force` overrides; `--prune` removes pristine orphans.

**CANON-16 survey:** `Stack`, `TML`, `Gate` moved from inline Zod to `src/kit/taxonomy.ts`; `schema.ts` re-exports for backward compat. `check-catalog-agents-parity.mjs` exists for invariants↔AGENTS parity; new script is distinct KIT domain.

**Consequences:** Catalog is single typed SSOT; INV-86 L1 gate catches drift; generator output is brownfield-safe; wave whitelist prevents phantom deferrals.

---

## ADR-054: Phase 3.5 handoff modeled as status.json fields (#703, 2026-05-18)

**Status:** Accepted
**Reference:** Issue #703

**Context:** Phase 3.5 requires a hard session boundary between planning phases (Opus) and
implementation phases (Sonnet). Two design options existed: (a) introduce a new `TaskPhase`
value (e.g., `planning-complete`) to represent the mid-boundary state, or (b) express the
boundary as fields on the existing `status.json` without touching the phase enum.

**Decision:** Model the handoff via `status.json` fields (`handoffStrategy`,
`planningHandoffReady`, `postClearResumed`, `hostCapabilities`) rather than adding a new
phase value. The arbiter phase enum stays: `preflight | plan | red-team-review |
red-team-rework | red | green | refactor | verification | complete`. The gate fires on the
`red-team-review → red` (or `red-team-rework → red`) transition, not at a dedicated phase.

**Consequences:** Phase enum is stable — no downstream consumers (CI workflows, dashboards,
docs) need updating. The handoff state is auditable via `status.json` diff. The boundary can
be re-checked idempotently: `planningHandoffReady` present + `postClearResumed` absent = gate
fires; both present = already resumed, no-op.

---

## ADR-053: Agent Registry introduction (#696, 2026-05-17)

**Status:** Accepted
**Reference:** Issue #696

**Context:** Arbiter's `.claude/agents/` directory contained four sub-agents (bridge-reviewer, codebase-scanner, context-checker, red-team) with no canonical index documenting their models, effort tiers, cost rationale, or interaction chains. The `.claude/rules/05-agent-lifecycle.md` already required DECISIONS.md updates for architectural agent changes, but the registry artifact itself was missing.

**Decision:** Create `.claude/AGENT_REGISTRY.md` as the canonical index of all sub-agents. It records: agent name, model, effort, cost rationale, six interaction chains (task start/completion/E2E fail/gate fail/migration/library lookup), and an escalation hierarchy. Update `.claude/rules/05-agent-lifecycle.md` to require AGENT_REGISTRY.md updates alongside DECISIONS.md. Add a one-line pointer in `AGENTS.md` §Multi-Agent Tool Extensions.

**Consequences:** Adding or removing agents now requires three artifacts: the agent file, the registry row, and a DECISIONS.md entry. This makes the agent fleet self-documenting and auditable.

---

## ADR-052: ISO 27001 / NIS2 / GDPR compliance gate mapping (#710, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #710; prior-art baseline COMPLIANCE_MAPPING.md §2; ISO 27001:2022 Annex A; NIS2 Art.21.2; GDPR Art.5/25/32

**Context:** The prior-art baseline ships a gate-to-control mapping table (COMPLIANCE_MAPPING.md §25-68) that maps every quality gate to the ISO 27001 Annex A / NIS2 Art.21.2 / GDPR article it satisfies, accelerating audit preparation. Arbiter had no equivalent — only the full Annex A matrix (L3-only, from #217).

**Decision:** Add three opt-in flags to `ProjectConfig`: `enableIso27001Mapping`, `enableNis2Mapping`, `enableGdprMapping`. When any flag is true, `generateCompliance` emits `docs/COMPLIANCE_MAPPING.md` from `src/templates/compliance/compliance-mapping.md.ejs`. The template has three conditional sections (ISO 27001, NIS2, GDPR), each with a gate-to-control table and an audit preparation checklist. Template uses `typeof` guards for optional fields. File is `skipIfExists: true`.

**Consequences:** Teams can opt into compliance reporting per framework (ISO 27001, NIS2, GDPR) without adopting all three. The generated document gives auditors a structured gate-to-control mapping. The `industrial-grade` preset (issue #729) will enable all three flags by default for regulated projects.

---

## ADR-051: Red-team SSOT alignment checks (#723, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #723; prior-art baseline FINDINGS.md#mech-M-15

**Context:** The prior-art baseline's red-team agent includes a dedicated SSOT (Single Source of Truth) alignment section that systematically checks for invariant drift, CANON rule compliance, registry completeness, opt-in wiring, ADR currency, changeset presence, and ratchet baseline updates. Arbiter's red-team agent lacked this structured checklist, risking inconsistent governance on generator/template PRs.

**Decision:** Add SSOT Alignment Checks section to both `src/templates/claude/agents/red-team.md.ejs` (generated version for target projects) and the materialized `.claude/agents/red-team.md` (arbiter self-governance). The section defines 9 checks, each with a specific query and severity mapping (HIGH for SSOT misalignment, MEDIUM for missing documentation).

**Consequences:** Future red-team reviews on generator/template changes are guided to systematically verify all governance artifacts. Generated projects also inherit this checklist via the EJS template.

---

## ADR-050: Risk register + P×I assessment template (#712, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #712; prior-art baseline R-PORT-03; ISO 27001:2022 §6.1.2

**Context:** The prior-art baseline ships a structured risk register (RISK_REGISTER.md, 489 LOC, 15 risks V-01..V-15) and a reusable per-risk P×I assessment template. Projects using arbiter lack a structured ISO 27001-aligned risk governance baseline.

**Decision:** Add opt-in `enableRiskRegister: true` flag. When set, `generateRiskRegister` emits two files into `docs/GOVERNANCE/`: (1) `RISK_REGISTER.md` — P×I matrix, classification thresholds, 5 universal pre-populated risks, plus archetype-conditional risks (DB for `backend-web-db`/`data-pipeline`, XSS for `frontend-spa`, rate-limit for `hasPublicApi`, tenant isolation for `isMultiTenant`); (2) `RISK_ASSESSMENT_TEMPLATE.md` — reusable per-risk assessment form covering threat description, P×I scoring rationale, treatment options, and approval workflow. Both files are `skipIfExists: true`.

**Consequences:** Teams get an immediately actionable ISO 27001 §6.1.2 risk governance baseline without mandatory adoption. The `industrial-grade` preset (issue #729) will enable this flag by default. The pre-populated risks are intentionally generic — teams customise post-init.

---

## ADR-049: Operations handbook generator (#717, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #717; prior-art baseline M-09

**Context:** The prior-art baseline ships a 3301-line operations handbook covering 4-signal observability (latency, traffic, errors, saturation), RC gate checklist, on-call protocol, and runbook templates. Projects using arbiter lack a structured baseline for operational readiness.

**Decision:** Add opt-in `enableOperationsHandbook: true` flag. When set, `generateOperations` emits `docs/OPERATIONS_HANDBOOK.md` from `src/templates/operations/handbook.md.ejs`. The template is archetype-aware: `backend-web-db` and `data-pipeline` add database signals and load-test gates; `frontend-spa` adds Core Web Vitals. The template is `skipIfExists: true` so teams can customise after init.

**Consequences:** Template provides an immediately actionable operational baseline. Teams are not required to use it (opt-in). The `industrial-grade` preset (issue #729) will enable this flag by default.

---

## ADR-048: 25-dimension test taxonomy extension (#719, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #719; prior-art baseline M-11

**Context:** The base `TEST_TAXONOMY.md` template covers 17 universal dimensions suitable for most projects. Industrial-grade projects (compliance, regulated industries, high-traffic APIs) require additional coverage for audit trails, PII masking, rate limiting, session lifecycle, event delivery, graceful degradation, SLA assertions, and OWASP security surface.

**Decision:** Add opt-in `enableTaxonomy25d: true` flag. When set, `generateTestTaxonomy` uses a new template at `src/templates/testing/test-taxonomy.md.ejs` that extends the base 17 dimensions with 8 compliance/industrial dimensions (18–25). The decision matrix is also extended with compliance-specific change types. The base template is unchanged — existing projects see no impact.

**Consequences:** Projects using the `industrial-grade` preset (issue #729) or compliance flags (`iso27001`, `nis2`, `gdpr`) will set this flag. Template is `skipIfExists: true` so teams can customise after init. All 25 dimensions map to existing INV references and external standards (GDPR, ISO 27001, OWASP ASVS, NIS2).

---

## ADR-046: MCP fallback determinism rule + cross-language skip-test guard (#721 #730, 2026-05-16)

**Status:** Accepted
**Reference:** Issues #721, #730; prior-art baseline M-13, NI-11
**Closes:** #721, #730

**Context:** Two extended-invariants issues batched: (a) MCP tools have no documented fallback when unavailable — silent downgrade creates non-deterministic session behavior; (b) skip annotations like `@Disabled`, `pytest.mark.skip`, and `t.Skip` can hide regressions and accumulate technical debt in test suites across Java, Python, and Go stacks.

**Decision:** Ship two artifacts:

1. **`45-mcp-fallback.md`** (opt-in rule, `enableMcpFallback: true`): documents approved fallback equivalents for GitHub MCP → `gh` CLI, file-system MCP → built-in tools, browser MCP → curl/wget, search MCP → grep/find. Protocol: switch without asking + emit `[mcp-fallback]` deviation log.
2. **`check-no-skipped-tests.mjs`** (default-on HARD hook, disable with `enableNoSkippedTests: false`): PostToolUse Edit|Write hook blocking `@Disabled`, `@Ignore`, `pytest.mark.skip`, `pytest.mark.xfail`, `t.Skip(`, `skip.test(`. Complements `check-no-placeholders.mjs` which already guards JS/TS `.skip()` and `xit()`.

**Consequences:**

- `check-no-placeholders.mjs` retains ownership of JS/TS test-skip patterns; `check-no-skipped-tests.mjs` adds Java/Python/Go without duplication.
- The MCP fallback rule is opt-in (default false) because not all projects use MCP tools — requiring it unconditionally would produce noise.
- `enableNoSkippedTests` defaults to true (emit unless explicitly disabled) because skipped tests are an unambiguous code smell with no legitimate permanent use.

---

## ADR-061: Batch-execution safety rule for parallel agents (#722, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #722
**Closes:** #722

**Context:** Claude Code supports spawning parallel sub-agents via the `Agent` tool. Concurrent agents that write shared state (git index, lockfiles, shared directories) cause non-deterministic corruption that is hard to recover from. No explicit rule existed to guide safe parallelism.

**Decision:** Emit a static Markdown rule file `50-batch-execution.md` via `generateClaudeRules` with `skipIfExists: true`. The rule codifies three things: (a) conditions under which read-only parallel agents are safe, (b) an explicit prohibition list (edits, commits, dependency installs, branch creation, deletes), and (c) a recovery protocol for parallel-agent collisions.

**Consequences:**

- Generated projects get a clear, enforceable rule about parallel agent safety at the governance level they need.
- `skipIfExists: true` lets project teams override/extend the rule without arbiter overwriting their customization on re-run.
- The rule is static Markdown (no EJS) — no template variables needed, reducing complexity.

---

## ADR-043: Matrix downgrade-vs-fix verdict — 7 HALF/FAKE proven cells (#377, 2026-05-14)

**Status:** Accepted
**Reference:** Issue #377; umbrella #344; CANON-02, CANON-03, CANON-07; INV-32
**Closes:** #377, #366

**Context:** Forensic audit (umbrella #344, Wave 3) flagged seven cells in `src/compatibility/cross-language-matrix.json` as `proven` while the supporting gate wiring was either HALF (template emitted but no `runCheck` step) or FAKE (no template at all). CANON-02 forbids a `proven` claim without (a) a template, (b) a wired step in `check-all.mjs.ejs`, (c) a fixture passing the gate, and (d) a regression test. Linked F-series fix issues were dispatched in parallel waves.

**Per-cell re-audit (2026-05-14):**

| #   | Cell                  | Pre-audit                 | Linked fix | Closed?                           | Gate step in `check-all.mjs.ejs`                                                                                                                                                                                  | Verdict                                    |
| --- | --------------------- | ------------------------- | ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | java × mutation       | HALF                      | #347, #371 | yes, yes                          | line 508-510 `mutation (pitest)` via `./gradlew pitest` / `mvn pitest:mutationCoverage`, `failWhenNoMutations` enforced (PR #685, #432)                                                                           | **STAY proven**                            |
| 2   | typescript × mutation | HALF                      | #347       | yes                               | line 506 `mutation (stryker)` via `npx stryker run` (PR #685)                                                                                                                                                     | **STAY proven**                            |
| 3   | java × contract       | HALF (argv bug + broker)  | #364, #376 | yes, yes                          | lines 538-557 `contract tests (Pact)` via `./gradlew pactPublish pactVerify` (broker env-gated, ADR-034)                                                                                                          | **STAY proven**                            |
| 4   | typescript × contract | HALF (broker URL missing) | #364       | yes                               | lines 519-523 `contract tests (Pact)` via `npx pact-broker can-i-deploy`, env-gated (PR #430)                                                                                                                     | **STAY proven**                            |
| 5   | python × e2e          | FAKE (no template)        | #366       | template + gate shipped (PR #687) | line 371-380 `pytest-playwright e2e` via ephemeral-server runner; templates `src/templates/e2e/playwright-python/{conftest.py,test_smoke.py}.ejs`; fixture `__tests__/fixtures/real-projects/python-backend-web/` | **STAY proven** — #366 closes with this PR |
| 6   | typescript × e2e      | HALF (lint only)          | #348       | yes                               | line 303-310 `playwright e2e` via ephemeral-server + `npx playwright test` (PR #687)                                                                                                                              | **STAY proven**                            |
| 7   | java × e2e            | HALF (implicit IT)        | #348       | yes                               | wired via Gradle/Maven integration step under L2 (PR #685); RestAssured-IT is the canonical integration runner for backend-web-db                                                                                 | **STAY proven**                            |

**Decisions:**

- **All seven cells stay `proven`.** Every cell now satisfies CANON-02 (a-d): template exists, gate step wired, fixture present, render/integration test passes.
- **#366 is closed by this ADR.** The recommended-verdict table in #377 proposed a downgrade only because templates were missing at audit time; PR #687 shipped the templates and gate step before this decision was reached. Closing #366 keeps the verdict consistent with reality on disk.
- **No `cross-language-matrix.json` edits required.** All seven cells already carry truthful `reason` strings. Touching `_lastUpdated` would be cosmetic.
- **CANON-02 regression guard is in-scope but deferred to #378.** The acceptance criterion "CANON-02 audit script (`scripts/check-canon-02-proven-gated.mjs`) added L1" is moved into #378's precondition list because the toggle catalog feature is the consumer that hardest depends on it. Tracking issue: follow-up to #378 (out of scope for this PR's docs-only delta).

**Consequences:**

- Matrix authority is preserved: future `proven` promotions inherit the CANON-02 audit script gate.
- The toggle-catalog work in #378 can source from a verified `proven` set without further matrix churn.
- Open child issue #366 transitions to closed (templates + gate shipped by #687).

---

## ADR-062: CLI catalog docs/COMMANDS.md generation (#728, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #728; prior-art baseline M-19; CANON-04, CANON-05, CANON-11
**Closes:** #728

**Context:** The prior-art baseline ships `FRAMEWORK/DOCS/COMMANDS.md` — a uniform, machine-generated command reference that lists every build/test/lint/format/gate command in one place. arbiter-generated projects had no equivalent, forcing developers to hunt commands across README and CI config.

**Decision:** Add `src/templates/documentation/cli-catalog.md.ejs` rendered as `docs/COMMANDS.md` by `generateDocs` at L2+. Sourced from `buildCommand`, `testCommand`, `lintCommand`, `formatCommand` fields already present in `ProjectConfig`. Uses `skipIfExists` (CANON-11). L1 skipped — L1 projects have minimal governance overhead.

**Consequences:**

- Every L2/L3 arbiter-generated project gets `docs/COMMANDS.md` on first `arbiter init`.
- Template namespace `src/templates/documentation/` created; separate from `src/templates/docs/` (which holds governance docs rendered outside the target project's `docs/` tree).
- No new `ProjectConfig` fields required — uses existing command fields.
- Baseline for `check-template-tests.mjs` bumped from 128 → 129 untested EJS files.

---

## ADR-044: User-toggle catalog preconditions + UX scaffold (#378, 2026-05-14)

**Status:** Proposed (preconditions track open)
**Reference:** Issue #378; umbrella #344; ADR-043; CANON-02/03/07/08
**Closes:** #378 (ADR delivery; implementation deferred per acceptance preconditions)

**Context:** Future feature: expose `arbiter init` and `arbiter configure` toggles for opt-in test categories (mutation, e2e, contract, BDD, a11y). User raised this in chat 2026-04-28. Naïve exposure risks false confidence: a toggle that enables-without-effect (cf. HALF cells in ADR-043) is worse than an opaque always-on default — users believe they have a gate they do not have.

**Decision:** Toggle UI is gated behind six hard preconditions; the ADR specifies the catalog source, the precondition set, and a minimal CLI scaffold that does **not** ship the toggle exposure yet (resist gold-plating; the deliverable is the contract, not the UI).

**Preconditions (HARD — all must hold before any per-category toggle is exposed):**

1. **All HIGH-severity F-series closed.** Tracking: #347, #361, #362, #363, #364, #365, #366, #371, #372, #373, #376. Status 2026-05-14: all CLOSED.
2. **Per-cell decision recorded.** #377 (ADR-043 above). Status: CLOSED with this PR.
3. **CANON-02 audit script wired L1.** `scripts/check-canon-02-proven-gated.mjs` must assert: every matrix cell with `maturity: proven` has a corresponding gate step in `check-all.mjs.ejs` AND a fixture under `__tests__/fixtures/real-projects/` AND a render test. Status: OPEN — tracked as a follow-up issue under #378.
4. **Per-toggle integration test.** Each exposed toggle category requires a render-and-execute test asserting: ON → generated gate fails on violation; OFF → gate skips silently and emits a CANON-02 marker.
5. **Toggle catalog sourced from matrix `proven` cells only.** `beta`/`unsafe`/`unavailable` cells are **invisible** to the prompt. Source of truth: `src/compatibility/cross-language-matrix.json`.
6. **Self-test matrix (subset).** Render each `2^N` toggle combination for at least one archetype per language; assert gate behavior matches the advertised toggle state. Critical-subset gating (rather than full Cartesian) is acceptable when N ≥ 6.

**Toggle-catalog data contract:**

- The catalog is a derived view, never a hand-edited list. Input: `cross-language-matrix.json`. Output: `{language, archetype} → toggleable_categories[]`.
- A category is `toggleable` iff: (a) the matrix cell is `proven`, (b) the gate step is conditionally rendered (already true for `mutation`, `contract`, `e2e`, `bdd`, `style_tokens`), (c) the toggle has a default state documented in the ADR catalog.
- Always-on categories (NOT toggleable): unit tests, coverage, static analysis, security audit. These are AAIF baseline.

**UX scaffold (post-precondition; this PR ships only the contract):**

```
arbiter init           # interactive prompt offers proven-only categories
arbiter configure      # already exists (src/commands/configure.ts); will gain
                       # features.* toggles already in ALLOWED_PATHS:
                       #   features.contractTesting
                       #   features.mutationTesting
                       #   features.securityScanning
                       #   features.evidenceHarness
                       #   features.debtGates
arbiter sync           # NEW (deferred): brownfield-respecting toggle change
                       # (CANON-11) — emits/removes templates idempotently
```

The existing `src/commands/configure.ts` ALLOWED_PATHS list **already enumerates** `features.contractTesting`, `features.mutationTesting`, `features.securityScanning`, `features.evidenceHarness`, `features.debtGates`, `features.soloDevMode`. This means the CLI plumbing for a subset of the toggle catalog is in place — the gap is the precondition guards (audit script, integration tests, brownfield `sync`), not the data path.

**Decisions:**

- **No code change in this PR.** ADR-044 is a contract document. Configure-command extension and `arbiter sync` are deferred to follow-up issues once preconditions 3-6 land.
- **Precondition 3 is the unblocker.** Until `check-canon-02-proven-gated.mjs` exists and runs L1, ADR-043's manual re-audit is not regression-proof. Follow-up tracking issue REQUIRED before any UI exposes a toggle.
- **Toggle catalog never exposes `beta`/`unsafe`/`unavailable` cells.** This is the load-bearing invariant. A future `arbiter configure --list-toggles` flag MUST filter on `maturity === 'proven'`.
- **Mutation, contract, e2e are toggle candidates.** Static, coverage, security are always-on (AAIF baseline; toggling would violate INV-29/30).

**Consequences:**

- The umbrella #344 toggle-catalog acceptance is split: ADR delivery (this PR) closes the design question; implementation acceptance remains gated on precondition 3 closure.
- `arbiter configure`'s ALLOWED_PATHS list becomes the de-facto toggle inventory; future schema changes MUST extend both the schema and this ADR's catalog table.
- A toggle exposed without precondition compliance is a CANON-02 violation — citation rule: `STOP — CANON-02 violation: toggle <category> exposed without proven-gated audit script in L1`.

**Out of scope:**

- Web UI for toggles (CLI-first; ADR-020).
- Per-toggle implementation (covered by F-series + Phase issues).
- Brownfield `arbiter sync` command (deferred; CANON-11 implication noted).

---

## ADR-047: evidence-prune.mjs + red-team SSOT alignment vectors (#718 #723, 2026-05-16)

**Status:** Accepted
**Reference:** Issues #718, #723

**Context:** Two related gaps: (1) `evidence-rotate.mjs` is automated and count-only; manual maintenance needed a sibling `evidence-prune.mjs` supporting `--keep-last`, `--keep-days`, `--dry-run`, `--yes`. (2) `.claude/agents/red-team.md` had general attack vectors but no arbiter-specific SSOT alignment checks.

**Decisions:**

- Emit `scripts/evidence-prune.mjs` (skipIfExists: true — user may customise thresholds) from new EJS template `src/templates/scripts/evidence-prune.mjs.ejs`.
- Emit `docs/METHOD/EVIDENCE_RETENTION.md` policy doc (skipIfExists: true) from `src/templates/governance/evidence-retention.md.ejs`.
- Add SSOT Alignment Vectors table to `.claude/agents/red-team.md` covering: template/materialized drift, invariant catalog vs gate, tier constant vs template, matrix cell vs gate reality, hook manifest vs generator, schema vs wizard defaults.

**Consequences:**

- `generateEvidenceRetention` emits 4 files at L1 (was 2) and 6 at L2+ (was 4).
- Evidence prune script is user-customisable (skipIfExists) unlike rotate (always regenerated).
- Red-team agent now covers arbiter self-consistency checks in addition to general security vectors.

---

---

## feat(#353 #354 #359): threshold-coherence templates (Phase 7A/7B/7G, 2026-05-14)

**Status:** Accepted
**Reference:** Issues #353, #354, #359; INV-60; CANON-04, CANON-08, CANON-09

**Context:** Three Phase 7 issues converge on threshold coherence across the generated coverage stack: #353 (TypeScript/vitest), #354 (Rust/tarpaulin coverage), #359 (Rust binary-size invariant). Each emits or modifies a tool config file gated by `governanceLevel` through the existing `computeThresholds` helper. PR #633 partially shipped #353 (`thresholdAutoUpdate:false`); this PR finishes the remaining curated-excludes scope and adds the two sibling templates.

**Decisions:**

- **Reuse `computeThresholds` (src/config/thresholds.ts) as the single threshold authority.** Issue spec mentions per-issue mappings (#353: L1 70 / L2 80 / L3 90; #354: L1 60 / L2 75 / L3 85) that diverge from the existing helper (fixed profile: L2 80, L3 85, L1 disables coverage). Aligning these is a cross-cutting policy decision with downstream impact (debt ratchet baselines, drift checks, AGENTS.md threshold tables). This PR reuses the helper as-is; threshold-spec drift is deferred to a follow-up issue.
- **Vitest curated `coverage.exclude` (#353):** Five entries with rationale comments — `*.d.ts`, `*.config.*`, `**/index.ts`, `**/*.test.ts`, `**/*.spec.ts`. Each entry is intentionally excluded; an `check-coverage-excludes-rationale.mjs` lint script that enforces comment-per-entry is deferred to a follow-up issue (out of "template" scope).
- **Tarpaulin `[default]` + `exclude-files` (#354):** Embeds `fail-under` in the toml so `cargo tarpaulin` hard-fails independently of the `--fail-under` CLI flag in `scripts/check-all.mjs`. Excludes carry rationale comments for `src/main.rs`, `src/lib.rs`, `build.rs`, `target/**`. The doc-vs-config parity check (`check-coverage-doc-parity.mjs`) is deferred — it is a standalone gate, not a template artefact.
- **INV-60 release-binary-size cap (#359):** Tier 4 operational, Rust-only (`languages: ['rust']`, `minGovernanceLevel: 'L2'`). Per-archetype budgets: `cli` → 10 MB, `embedded` → 5 MB. Defaults are **inlined** in `src/generators/coverage.ts` and `src/generators/check-all.ts` (rather than exported from `src/config/thresholds.ts`) to avoid expanding the public API surface tracked by INV-02 / debt ratchet. The two copies are 4-line functions with matching signatures and a cross-reference comment.
- **No new `rust-binary` archetype:** The #359 issue text references `rust-binary`/`rust-desktop` archetypes that do not exist in `src/wizard/types.ts` (current enum: `backend-web-db | cli | library | data-pipeline | frontend-spa | embedded`). The size step gates on `archetype === 'cli' || archetype === 'embedded'` rather than introducing a new wizard/detector/matrix-cutting Archetype value. A new archetype taxonomy is its own follow-up.
- **Generated check-all.mjs size step:** Inline ad-hoc gate (pushResult/spawnSync pattern) inside the Rust L2 block. Skips when no release binary exists (freshly-cloned repo). Honours `graceActive` grace-period semantics consistent with the surrounding gates.
- **Cargo.toml.profile.release.ejs materializes at `docs/coverage/Cargo.toml.profile.release`** rather than overwriting the project's `Cargo.toml`. Operators append the block manually; the path-segregated emission avoids collisions and surfaces the policy snippet as documentation.

**Consequences:** Three thresholds now scale consistently with `governanceLevel` via a single computeThresholds call. INV-60 brings release binary sizes under explicit gate, with archetype defaults documented in the generated toml comment. The deferred items (rationale lint, doc-parity gate, threshold-policy realignment, new archetype enum value) are tracked as follow-ups rather than shipped half-done.

---

## feat(#263): time-travel governance — arbiter blame (2026-05-13)

**Status:** Accepted
**Reference:** Issue #263; CANON-16

**Context:** The Provenance Graph (Wave-1, #259) captures static relationships between governance artefacts. Issue #263 extends it with a temporal dimension: given a node id (INV-NN, ADR-NNN, FILE:path), reconstruct its governance history from git commits and Notary footer records, and render a blame timeline.

**Decisions:**

- **`src/graph/history.ts` — temporal harvester**: Runs `git log --format=...` (via existing `runCli` utility, INV-12 compliant) and maps raw commit entries to `HistoryEvent` objects. For INV/ADR/CANON nodes, filters by node id appearing in commit subject or Notary `Intent:` field. For `FILE:` nodes, scopes the log to the file's pathspec for performance. Returns events sorted oldest-first; deterministic for the same repo state.
- **`src/graph/blame.ts` — timeline builder + formatters**: Pure functions over `HistoryEvent[]`. `buildTimeline()` classifies each event (CREATED/ENFORCED/MODIFIED/MENTIONED/UNKNOWN) using keyword matching on commit text. Four renderers: `text` (human-readable), `json` (machine-readable), `mermaid` (timeline diagram), `markdown-audit` (table report).
- **`src/commands/blame.ts` — CLI entry**: Mirrors the `trace.ts` pattern — load snapshot, resolve node, harvest history, render. `skipGitLog` flag for unit tests avoids git dependency in test environment. `BlameFormat` union type: `text | json | mermaid | markdown-audit`.
- **`src/compliance/loader.ts` — optional compliance.yaml**: Reads `.arbiter/compliance.yaml` if present; maps INV IDs to SOC2/ISO/PCI control IDs. Custom minimal YAML parser — no external dependency. Returns `undefined` when file absent (graceful degradation).
- **`GraphNode` temporal fields**: Extended `src/graph/model.ts` with optional `created_at?: string` and `commit_ref?: string` fields. Backwards-compatible: existing snapshots without these fields deserialise without change.
- **NDJSON history store**: `.arbiter/graph.history.ndjson` (append-only) for future incremental harvesting. `appendHistoryEntry` / `readHistoryEntries` functions in `history.ts`. File is optional — blame falls back to real-time git log when absent.
- **Performance**: Blame on single INV node < 2s enforced by integration test (5s CI budget). FILE: nodes use pathspec-scoped git log; INV/ADR nodes use full log filtered in memory. No git operations against remote.
- **Dogfood**: `__tests__/integration/blame-dogfood.test.ts` runs blame on INV-01 against the arbiter repo itself and asserts non-empty output and < 5s wall time.
- **CLI registration**: `arbiter blame` added to `src/cli.ts` after `arbiter trace`, consistent naming convention (top-level command, not nested).

**Consequences:** `arbiter blame INV-NN` provides a full governance audit trail for any invariant. Optional `compliance.yaml` maps invariants to SOC2/ISO/PCI controls, enabling compliance reporting. The temporal extension is additive — no existing graph functionality is modified.

---

## feat(#259): provenance graph followup — 6 builders + verify modes + full-graph formats (2026-05-13)

**Status:** Accepted
**Reference:** Issue #259; INV-54, INV-55, INV-56

**Context:** Wave-1 (#259 core) shipped the INV builder and orphan-invariant verify mode. The followup ships the remaining graph infrastructure: 6 new builders that harvest ADR/REQ/AST/test/evidence/CANON nodes from the project, 4 new verify failure classes (orphan-node, broken-ref, missing-evidence, stale-prover), and dot/mermaid full-graph export.

**Decisions:**

- **6 builders added:** `adr` (DECISIONS.md), `req` (FEATURE_MATRIX.md / REQUIREMENTS_MATRIX.md), `ast` (JSDoc `@enforces`/`@invariant`), `test-nodes` (`[INV-NN]` tags in test titles), `evidence` (`.evidence/SUMMARY.json`), `canon` (CANON.md `## CANON-NN` sections). All degrade gracefully when source file is absent.

- **Shared utils extracted:** `src/graph/builders/utils.ts` provides `walkFiles()` (deterministic sorted walk), `extractInvRefs()`, `unique()`. CANON-16 (refactor-first) satisfied: no prior utility existed.

- **4 verify failure classes:** `orphan-node` (non-GATE node with zero edges), `broken-ref` (edge endpoint missing — detected via raw JSON scan before store construction to avoid throw), `missing-evidence` (INV enforces GATE without produces edge, gated on evidence infrastructure present), `stale-prover` (TEST node path absent on disk). `orphans` field preserved for backward compat.

- **Full-graph formats:** `graph build --format dot|mermaid` writes to `.arbiter/graph.dot` / `.arbiter/graph.mermaid` alongside the default `graph.json`. `--format` wired into CLI.

- **Regex-only AST scanner:** TypeScript compiler API rejected (runtime dep cost). `@enforces`/`@invariant` JSDoc tags are regex-matched; limitation documented (multi-line annotations may be missed).

**Consequences:** The provenance graph now covers all 9 node kinds and 8 edge kinds. Verification surface expanded to 5 failure classes. Dot/mermaid export enables external visualization. All builders are non-fatal degrading — a missing source file yields 0 nodes for that domain without breaking the build.

---

## feat(#262): Semantic Diff Review — review diff command design (2026-05-13)

**Status:** Accepted
**Reference:** Issue #262

**Context:** Semantic diff review requires comparing two graph snapshots (base vs head). Building the snapshot at each git ref requires either checking out each ref or running the build in a temp dir. For the CLI command, we accept pre-built snapshot paths so the caller controls how snapshots are obtained (e.g., via CI artifact or local git stash). The `--post-pr` flag posts markdown via `gh pr comment`.

**Decisions:**

- `runReviewDiff` is a pure function over two `GraphSnapshot` objects — testable without git.
- The CLI `review diff` accepts `--base` and `--head` paths (not git refs) to keep the command side-effect-free.
- `renderMarkdown` is a separate export for use by the GitHub Actions step and `--post-pr`.
- The workflow template `semantic-review.yml.ejs` is gated on `L2 | L3` only (light governance projects don't need it).
- NodeKind closed set: existing kinds (INV, ADR, TEST, FILE, GATE, SYMBOL) are sufficient for all three issues. No new kinds needed.

**Consequences:** The `review diff` command requires pre-built snapshots. CI must run `arbiter graph build` at base and head refs separately. The workflow template shows the canonical pattern.

---

## feat(#261): Governance-Aware Affected CI — ci plan design (2026-05-13)

**Status:** Accepted
**Reference:** Issue #261

**Context:** `arbiter ci plan` needs to traverse the provenance graph from changed files to find impacted invariants and required gates. In Wave-1, only INV+GATE nodes exist (no FILE/SYMBOL builders yet). Graceful fallback is required.

**Decisions:**

- Fallback when no graph: emit `risk_class: R-unknown, fallback: true` — never error, always emit a plan.
- Risk class is computed from file path patterns (same rules as `src/risk/classifier.ts`) independently of the graph traversal.
- Changed files are passed as `changedFiles` parameter (not resolved from git) so the function is testable.
- `ci verify-plan` accepts a plan JSON + CI result JSON — no filesystem side effects.
- Catalog-touching files (invariants/catalog.ts, AGENTS.md) trigger all INVs as impacted.

**Consequences:** When the graph has no FILE nodes (current Wave-1 state), `ci plan` falls back gracefully. Full traversal becomes useful after FILE/SYMBOL builders are added in future waves.

---

## feat(#260): Gauntlet pairwise test generator — algorithm and emitter design (2026-05-13)

**Status:** Accepted
**Reference:** Issue #260

**Context:** Pairwise/combinatorial test generation requires an IPOG (In-Parameter-Order General) algorithm, per-stack emitters, and a hash-based sync gate.

**Decisions:**

- IPOG is a greedy deterministic algorithm — output is byte-stable across runs. Optimal row count is not guaranteed (worst case ~20% above theoretical minimum for 3×3×3 case).
- YAML parsing is done with a bespoke minimal parser (no external dependency). Rationale: js-yaml uses ESM (`./dist/js-yaml.mjs`) which fails with `ERR_UNSUPPORTED_DIR_IMPORT` when the module resolver traverses a symlinked `node_modules` in worktrees with `#` in the path. The spec format is simple enough to parse without a full YAML library.
- NodeKind closed set: gauntlet spec → `SYMBOL` (subkind: "gauntlet-spec"), tests → `TEST`. No new NodeKinds needed.
- The hash gate uses SHA-256 over normalised spec text (normalised line endings, trailing whitespace stripped).
- Stack emitters: TypeScript (Playwright `test.describe`/`for` loop), Java (JUnit5 `@ParameterizedTest` / `@MethodSource`), Rust (`#[rstest]` / `#[case]`).

**Consequences:** The YAML parser supports the spec subset only. If the spec format grows (anchors, multiline strings, etc.), migrate to a proper YAML library. The IPOG implementation uses a greedy heuristic; for strict minimum row count, a backtracking solver would be needed.

---

## feat(#470): soloDevMode — trade-offs and invariant design (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-58, INV-59

**Context:** Solo-dev workflow: single developer wants to merge directly after local L2 passes, without waiting for PR CI and review ceremony. Premise: "local gate ≡ CI gate, so CI on PR is redundant." Phase A–F of #470 reinforces parity first (INV-58 Node SSOT, INV-59 gate result hash), then introduces the option.

**Decisions:**

- **PR ceremony retained:** INV-23 (direct push to main banned) remains enforced. `soloDevMode` relaxes branch protection (no required reviews, no required CI status checks) but PR still exists. Merge is via `gh pr merge --admin --squash`.

- **No-op CI on PR:** When `soloDevMode=true`, the generated `ci.yml` emits a solo-dev-gate job that exits immediately (echo only). Full CI still runs on push to `main`. Branch protection is permissive so the no-op job is sufficient to merge.

- **Nightly drift shadow:** A separate `drift-shadow.yml` workflow runs nightly to catch parity regression (INV-59 hash comparison). On mismatch it opens a GitHub issue tagged `inv-59-drift`. This substitutes for the per-PR CI second opinion.

- **Parity prerequisite:** `soloDevMode` is meaningful only when INV-59 parity holds. The feature flag is documented to require parity evidence; drift detected by the nightly shadow should block enabling solo mode.

- **Team conversion risk:** Branch protection is permissive. If collaborators join the repo, `arbiter doctor` (future) should warn when `soloDevMode=true` and >1 collaborator detected.

**Consequences:** Solo developer can merge PRs after local L2 green without PR CI delay. Nightly drift shadow catches environmental divergence within 24 hours. Parity invariant (INV-59) must hold for the premise to be valid.

---

## feat(#470): Gate result parity — INV-59, parityContentHash, CI aggregation (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-59

**Context:** soloDevMode (Phases C-F of #470) requires proof that local L1 gate results are idempotent to CI gate results. Without a structured artifact and a hash comparison, "local ≡ CI" is an untested claim. Phase B addresses this: emit JSON on every gate run, compare hashes in L2.

**Decisions:**

- **Gate result JSON (schema `arbiter-gate-v1`)**: `check-all.mjs` now always writes `.arbiter/gate/local-result.json` (gitignored under `.arbiter/`). `--json <path>` overrides the destination (used by CI gate-aggregation to write `gate-result.json`).

- **Parity subset (27 static L1 gates)**: `parityContentHash` = sha256 over sorted `[{name, pass}]` for deterministic L1 gates only. Excluded: `commitlint` (PR-only in CI), `docs` (PR-only in CI), `unit tests` (split 4-way in CI vs single `npm test` locally). All other 27 L1 gates are structurally identical in both environments.

- **CI gate-aggregation job**: Runs `node scripts/check-all.mjs L1 --json gate-result.json` after `lint-and-test` passes, uploads `gate-result` artifact (30-day retention). Added to `ci-required` needs.

- **INV-59 enforcement (`check-local-ci-parity.mjs`, L2)**: Downloads latest CI artifact via `gh run download`, compares `parityContentHash`. Neutral skip (exit 0) when `gh` unavailable, no CI artifact, or no local result — ensuring the gate doesn't block projects without CI configured. Hard fail (exit 1) on hash mismatch.

- **`check-ci-alignment.mjs` exemptions**: Added `scripts/check-local-ci-parity.mjs` (local-only L2 gate) and `scripts/check-all.mjs` (CI aggregation runner, not a quality gate) to `DESIGN_EXEMPTIONS`.

**Consequences:** Every `check-all.mjs` run (L1 or L2) now produces a machine-readable artifact. L2 includes a parity check. When parity drifts, the hash mismatch surfaces the specific differing gates. soloDevMode can now gate on `parityContentHash` equality as a prerequisite check.

---

## feat(#470): Node version SSOT — INV-58, .nvmrc canonical source (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-58

**Context:** Node 20 was hardcoded in 10 workflow files and 14 EJS templates. Local dev ran on Node 22. This made local↔CI parity impossible by construction — a prerequisite for the soloDevMode invariant (INV-59, coming in Phase B of #470).

**Decisions:**

- **INV-58 — Node version SSOT**: `.nvmrc` at repo root is the single source of truth. All CI workflows use `node-version-file: '.nvmrc'`. EJS templates emit the same pattern to target projects. `process.version` major must match `.nvmrc` major. Enforced by `scripts/check-node-version-ssot.mjs` (L1 gate).

- **Version**: `22.21.1` (local dev version). `package.json#engines.node` bumped to `>=22.0.0`.

- **Pre-push guard**: `.githooks/pre-push` and `src/templates/githooks/pre-push.ejs` now assert Node major matches `.nvmrc` before running the L2 gate. Fails fast with `nvm use` hint.

- **GIT_COMMON_DIR fix**: `.githooks/pre-commit` and `src/templates/githooks/pre-commit.ejs` now unset `GIT_COMMON_DIR` alongside other git env vars. This was causing integration test timeouts in worktrees where `GIT_COMMON_DIR` leaked into spawned git processes.

- **Template**: `src/templates/.nvmrc.ejs` emits a single-line `.nvmrc` to target projects via the github generator.

**Consequences:** Local and CI now use the same Node major. The Node version drift defect (one of 6 blocking parity) is resolved. `check-node-version-ssot.mjs` fails the L1 gate if any literal `node-version: 'N'` pin is found anywhere in workflows or templates.

---

## feat(#258): HA1 self-validation harness + exit-code universal contract (2026-05-12)

**Status:** Accepted
**Reference:** Issue #258; INV-53

**Context:** Arbiter gates claimed behavioral semantics (pass/fail) but never proved them. A gate that silently misbehaves (exits 0 on a violation, or crashes without an exit code) is indistinguishable from a healthy gate to orchestrators. Additionally, no standard governed which exit codes gates should use — some gates used only 0/1, others could theoretically exit any value.

**Decisions:**

- **INV-53 — Exit-code universal contract**: Every Arbiter-emitted script must exit `0=PASS / 1=FAIL / 2=ERROR`. Enforced by `check-exit-code-contract.mjs` (L1 gate) which scans `scripts/*.mjs` and `src/templates/scripts/*.ejs` for `process.exit(N)` where N ∉ {0,1,2}.

- **A/B/C drill harness**: `scripts/self-validation.mjs` (generated by `src/generators/self-validation.ts`) runs three phases per gate — A (clean fixture → expect 0), B (drift fixture → expect 1), C (bad args → expect expected error code). Registered as L2 gate. Template at `src/templates/scripts/self-validation.mjs.ejs`; materialized copy kept at `scripts/self-validation.mjs` (INV-45 dogfood pattern — template and materialized must be identical).

- **Advisory pipe/tee hazard**: `check-pipe-tee-hazard.mjs` detects `| tee` without `set -o pipefail` or `PIPESTATUS[0]` guard. Advisory only (always exits 0). Registered as L1 but self-advisory; promotion to blocking deferred pending noise-floor measurement.

- **Name disambiguation**: Issue #258 specified `harness.ts` but "harness" was already overloaded by `evidence-harness` (`enableEvidenceHarness`, `evidence-retention` generator). Renamed to `self-validation` throughout: `src/generators/self-validation.ts`, `scripts/self-validation.mjs`, `enableSelfValidationHarness`.

- **INV slot**: Issue specified INV-42 but that slot is taken by Pact-broker env-gating (INV-42, catalog line 658). Used INV-53 (next free slot after INV-52).

- **Staged rollout**: Initial drill covers 2 gates (exit-code-contract, pipe-tee-hazard). Full 18-gate fixture expansion tracked as a follow-up issue to avoid 50+ fixture proliferation in this PR.

**Consequences:** L1 gate now enforces exit-code discipline across all emitted scripts. L2 gate proves each registered gate's behavioral contract. New gates added to Arbiter must declare their A/B/C expected codes in the drill manifest.

---

## feat(#241,#242,#243): evidence schema hardening, INV-31 suppression wiring, BACKLOG generator (2026-05-12)

**#241 — EvidenceSummary schema enforcement:**
`head_sha`, `head_sha_short`, `obs_gate`, `tests`, `coverage`, `mutation`, `security`
promoted to REQUIRED fields in `src/evidence/summary.ts`. `validateSummarySchema`
now wired into `runVerifyEvidence` (after SHA check) so the L2 gate actually rejects
malformed SUMMARY.json. `evidence-collect.mjs.ejs` emits both SHA fields inline.

**#242 — INV-31 suppression expiry wiring (CANON-09):**
`check-suppressions.mjs` added unconditionally to `scripts/check-all.mjs` and CI
(was missing; AGENTS.md claimed enforcement but script was never called). Registry
`suppressions` entry changed to `enabled: true`; generator internally guards
file-based suppression files on `enableSuppressions`, but always emits
`check-inline-suppressions.mjs`.

**#243 — BACKLOG.md generator:**
New `evidence-backlog` generator emits `.evidence/BACKLOG.md.template` at L2+
(`skipIfExists: true`). Registered in registry with `GeneratorKey "evidence-backlog"`.
`task.md.ejs` Phase 1 step 5 instructs Standard-tier tasks to copy template into
task-scoped evidence directory.

---

## feat(#240): check-ci-alignment.mjs — L1 CI/manifest gate parity check (2026-05-11)

Adds `scripts/check-ci-alignment.mjs` as an L1 gate that parses
`scripts/check-all.mjs` (manifest) and `.github/workflows/ci.yml` (CI),
derives normalized gate keys, and fails if any gate is present in one but
not the other.

Key design decisions:

- **DESIGN_EXEMPTIONS**: `scripts/check-docs.mjs` (CI runs inline shell),
  `npx:commitlint` (conditional PR-only), `npm:test` (CI splits into jobs),
  `npm:audit` (CI before L2), `npx:knip` (CI in lint-and-test).
- **Block scalar parsing**: `run: |` detected before single-line `run:`.
- **Target only `ci.yml`**: Avoids false positives from matrix workflows.
- **CI alignment fix**: Added 5 missing L1 steps; replaced npm scripts with
  direct binary calls for key matching.
- **Generator**: `src/generators/check-all.ts` emits `check-ci-alignment.mjs`
  via new EJS template (CANON-05, CANON-11 satisfied).

---

## feat(#398): ArchUnit hexagonal suite parity — 3 new templates (2026-05-10)

Adds `NamingConventionsTest.java.ejs`, `AntiCyclicTest.java.ejs`, and
`NoH2ArchTest.java.ejs` to `src/templates/archunit/`, completing production baseline
parity for the hexagonal enforcement suite. `emitHexagonalSuite()` in
`src/generators/archunit.ts` now emits 7 test files (up from 4).

- **NamingConventionsTest**: enforces `*Service`, `*Repository`, `*Controller`,
  `*Port` suffixes for the four hexagonal stereotypes.
- **AntiCyclicTest**: uses `SlicesRuleDefinition.slices().matching(basePackage + ".(*)..").should().beFreeOfCycles()`.
- **NoH2ArchTest**: bans `org.h2..` imports in production code; H2 is
  test-only.

The java fixture manifest gains `architectureStyle: "hexagonal"` and
`basePackage: "com.example"` so integration tests exercise the full suite.
CANON-07 (shell-script execution in tests) does not apply — templates emit
Java test files, not shell scripts. Render-correctness assertions suffice.

---

## chore: typescript-eslint 8.58.2 → 8.59.2 (2026-05-10)

Stricter rules in 8.59.2 flagged three patterns across the codebase:

- `src/cli.ts`: removed redundant `as GovernanceLevel` cast (already typed by Commander)
- `src/config/schema.ts`: removed `as unknown as ArbiterConfigV2` cast from `migrateV1ToV2` return (object literal now satisfies the type directly)
- `src/decomposition/github-backend.ts`: `Promise.reject(err as Error)` → guard that wraps non-Error values

---

## Fix #298: drop redundant ProjectConfig intersection cast in archunit (2026-05-01)

`emitHexagonalSuite` in `src/generators/archunit.ts` no longer takes
`ProjectConfig & { basePackage: string }`; `basePackage` is passed as a
separate `string` parameter from the if-guarded call site. The previous
cast at the call site would have silently lied if the guard at
`generateArchUnit:139` (`config.architectureStyle === "hexagonal" && config.basePackage`)
were ever relaxed, leading to `basePackage.replace(...)` throwing on
`undefined` inside the function body. The new signature makes the
non-empty contract local to the call site and removes the intersection
cast entirely.

---

## Fix #300: route check-no-pii.mjs emit through renderTemplate (2026-05-01)

`src/generators/security.ts` now emits the PII hook via
`renderTemplate("claude/hooks/check-no-pii.mjs", data)` instead of a
direct `readFileSync(import.meta.dirname/...)`. `renderTemplate` resolves
its templates via `fileURLToPath(import.meta.url)`, which is portable
across all Node versions; `import.meta.dirname` is Node 20.11+ only and
is undefined under some bundler configurations. The change also aligns
the security generator with the pattern already used in
`src/generators/claude.ts` for sibling static `.mjs` hooks
(`stop-dangerous`, `enforce-read-only`, `pre-edit-ssot-guard`,
`check-no-orphan-todo`). The template contains no `<%`/`%>` delimiters
so EJS pass-through is byte-identical.

---

## Fix #297: guard parse + shape of existing .claude/settings.json (2026-05-01)

`generateClaude` in `src/generators/claude.ts` now routes the read of
the existing `.claude/settings.json` through a new
`parseExistingSettings` helper. The helper wraps `JSON.parse` in a
`try`/`catch` (preserving the original error via `{ cause }`) and then
shape-validates the parsed value with an `isPlainObject` predicate
(`typeof === "object" && !== null && !Array.isArray`). On malformed
JSON or a non-object root (`null`, array, primitive), the helper
throws an `Error` prefixed with
`"Failed to parse existing .claude/settings.json: <msg>. Fix or delete and re-run."`.
Previously a malformed file killed `arbiter init` with a bare
`SyntaxError`, and a non-object root silently corrupted the file:
`mergeSettingsJson` does `{ ...existing }`, which turns arrays/strings
into `{ "0": ..., "1": ... }` objects and writes the result back to
disk without erroring.

---

## ADR-030: Consolidate /start-task + /complete-task → /task

**Date:** 2026-04-17
**Status:** Accepted
**Reference:** prior-art baseline PR #2698 (ADR-094)

**Context:** The two-file split between start-task and complete-task created drift over time as the commands diverged. The PLAN→EXEC boundary is enforced by the MANDATORY STOP line, not by file separation.

**Decision:** Merge both commands into a single `/task` command that covers the full lifecycle: branch enforcement → plan → STOP → implement (TDD) → gate → commit → PR → merge.

**Consequences:** Simpler maintenance (one file to update), single entry point for all task lifecycle operations, reduced documentation surface. Breaking change: `/start-task` and `/complete-task` no longer exist in generated projects — consumers must update to `/task`.

---

## ADR-031: `CliError.notFound` + stricter Kotlin detection

**Date:** 2026-04-24
**Status:** Accepted
**Reference:** PR #339 (closes #330, #331, #332)

**Context:** Two defects in the compatibility probe layer collapsed distinct failure modes into one status. `CliError` exposed only `timedOut`/`exitCode`, so ENOENT was only detectable via a message regex or `exitCode === -1` convention. `probeTool` collapsed every `CliError` into `skipped: toolchain-missing`, making a 10-second timeout look identical to an uninstalled tool. Separately, the `runProbes` dispatch lacked a `kotlin` branch, so Kotlin projects received `entries=[]` despite `matrix.json` defining a kotlin row.

**Decision:**

1. `CliError` gains a discriminated `notFound: boolean` field set only on `ENOENT`. `probeTool` / `runBuildProbe` / `fetchGithubData` branch on `notFound → timedOut → default non-zero` to produce precise reasons (`probe timeout (Nms)`, `exit N: <stderr>`, `build tool missing: <cmd>`, `build-file-not-found: <path>`).
2. `detectLanguage` returns `"kotlin"` only when `src/main/kotlin` exists **and** contains at least one `.kt` source (bounded recursive walk, budget 200). IDE-created empty directories do not reclassify Java projects.
3. `matrix.json`'s kotlin row includes `gradle` so mixed Java+Kotlin Gradle projects keep their gradle version probe.
4. `validateMatrix` (exported from `probe.ts`) replaces the load-time `matrixJson as RawMatrix` cast; malformed JSON throws with the offending key path. `LanguageMatrix` / `MatrixEntry` in `schema.ts` are the single type source.

**Consequences:** CLI callers that previously pattern-matched on `/not found/` regex can now branch on `err.notFound`. The `kotlin` language becomes addressable in the Language union; the `src/main/kotlin` heuristic is conservative and will miss exotic project layouts (pure Kotlin with sources outside `src/main/kotlin`), which is acceptable given the alternative is misclassifying Java projects. `validateMatrix` throws at module load on malformed `matrix.json`; `init.ts` already wraps `runProbes` with user-facing error handling, so the failure mode is loud rather than silent.

---

## ADR-032: Codex CLI hook parity via adapter shim

**Date:** 2026-05-10
**Status:** Accepted
**Reference:** PR #416

**Context:** Arbiter-governed projects gain hook-based invariant enforcement through `.claude/hooks/*.mjs` scripts (orphan TODO check, SSOT guard, PII scan, dangerous-command block, etc.). Developers who use Codex CLI instead of Claude Code lose this enforcement entirely: Codex does not read `.claude/settings.json` and fires hooks from `.codex/config.toml`. The issue originally proposed adding `process.env.CODEX_TOOL_INPUT_PATH` fallbacks inside every hook. This was rejected: Codex never sets env vars — it pipes a JSON payload on stdin. The env var fallbacks would be dead code.

**Decision:** Generate a thin adapter shim (`.codex/codex-adapter.mjs`) alongside `.codex/config.toml` at `arbiter init` time. The adapter:

1. Reads the Codex stdin JSON payload
2. For `bash` tool: sets `CLAUDE_TOOL_INPUT_COMMAND` from `tool_input.command`
3. For `apply_patch` tool: parses `*** Update File: <path>` lines from the unified diff in `tool_input.command`, sets `CLAUDE_TOOL_INPUT_PATH`, runs the hook once per file
4. Delegates to the target `.claude/hooks/*.mjs` via `execFileSync`, propagating the exit code
5. Exits 0 on unknown tools (safe no-op for future Codex tools)

The existing hook scripts remain the SSOT — zero changes to their source. The adapter is generated as a static copy (not EJS-rendered); `config.toml` is EJS-rendered with the same governance-level guards as `settings.json`.

The `.arbiter/hooks-manifest.json` gains a `tools` field per entry (`["claude"]` default, `["claude","codex"]` for statically-spawnable HARD hooks). `check-hardness-inventory.mjs` verifies that every `tools:["codex"]` manifest entry has a corresponding adapter reference in `config.toml.ejs`.

**Consequences:** Developers on Codex CLI receive the same enforcement as Claude Code users for the five statically-spawnable HARD hooks. EJS-rendered hooks (plan-anchor, completion-guard, done-evidence, etc.) are Claude Code-only and remain so — they depend on session-level state that Codex does not expose. The `apply_patch` hook coverage depends on Codex emitting `apply_patch` PreToolUse/PostToolUse events reliably; as of May 2026 this is tracked upstream (openai/codex#16732).

---

## ADR-033: check-no-pii.mjs hook template renamed to .mjs.ejs (CANON-04)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #164

**Context:** `src/templates/claude/hooks/check-no-pii.mjs` was a static JavaScript file emitted via `renderTemplate()` without the `.ejs` extension. CANON-04 requires every file consumed by `renderTemplate()` to carry the `.ejs` suffix so tooling (drift checks, template audits) can distinguish rendered templates from static assets.

**Decision:** Rename the file to `check-no-pii.mjs.ejs`. No content changes — the file contains no EJS tags and renders identically. Update the generator reference in `security.ts` and the `.arbiter/hooks-manifest.json` entry accordingly. Add a CANON-04 render test.

**Consequences:** The `.mjs.ejs` suffix makes the file's role explicit. The hardness-inventory `spawnable: true` classification is retained because the file remains pure JavaScript with no EJS syntax, so the empirical exit-code test continues to pass by spawning the file directly. Codex parity check strips the `.ejs` suffix when verifying the codex config template, so no change to `codex/config.toml.ejs` is needed.

---

## ADR-034: INV-41 and INV-42 — Schema Registry testCompatibility and Pact broker env-gate

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #362 (#344 F3), #364 (#344 F5)

**Context:** Audit finding F3 revealed that `src/templates/contract-testing/message-queue/` performed reachability checks (HTTP GET /subjects) rather than actual schema compatibility verification. Finding F5 found that `check-all.mjs.ejs` packed `'pactPublish pactVerify'` as a single spawnSync argv element (shell:false) causing silent failures, and emitted no `PACT_BROKER_BASE_URL` / `PACT_BROKER_TOKEN` forwarding.

**Decision (INV-41):** All 5 language message-queue templates must call `testCompatibility()` (or language-equivalent REST POST to `/compatibility/subjects/{s}/versions/latest`) and assert BACKWARD or FULL compatibility level. Reachability-only checks do not satisfy the invariant.

**Decision (INV-42):** All Pact broker runCheck invocations in `check-all.mjs.ejs` and CI workflow steps must be wrapped in a `PACT_BROKER_BASE_URL` environment check. When unset, the gate emits a visible SKIP log and does not error. When set, `PACT_BROKER_TOKEN` is forwarded as a system property or env var. No hardcoded broker URL is permitted.

**Consequences:** Message-queue contract tests now provide genuine schema evolution safety. Pact broker steps no longer silently fail against a missing broker. The `.env.pact` scaffold (committed with empty values) and `.gitignore` pattern ensure tokens are never committed to source control.

---

## ADR-035: Inline arbiter-suppress directive parser (F8 from #344, INV-31 extension)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #367

**Context:** Audit finding F8 identified that INV-31 (suppression expiry) was only enforced for file-based `suppressions/` entries. Inline comment suppressions (e.g. `// arbiter-suppress(INV-04, ...)`) were silently vacuous — no validator ran, so any expired or malformed directive passed undetected. Additionally, five PostToolUse hooks (`check-no-any`, `check-no-orphan-todo`, `check-no-pii`, `check-no-direct-spawn`, `check-no-placeholders`) blocked violations with no escape hatch, making it impossible to legitimately suppress a finding in source code.

**Decision:** Add `scripts/check-inline-suppressions.mjs` (and matching EJS template `src/templates/scripts/check-inline-suppressions.mjs.ejs`) that scans source files for `// arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=@handle)` directives and validates: non-expired `until=` date, `reason` ≥ 10 chars, `owner` present, INV-NN known in catalog. Wire this check unconditionally in the L1 gate (CANON-09) so it runs regardless of the `enableSuppressions` flag — CANON-01 dual-sided enforcement applies. Extend `check-no-any`, `check-no-orphan-todo`, and `check-no-pii` hooks to consult the inline suppression parser before blocking; hooks remain HARD when no directive or directive invalid/expired. Extract `parseArgs` (quote-aware comma tokenizer) to `scripts/lib/suppressions-shared.mjs` to eliminate divergence between the script and hook implementations.

**Consequences:** INV-31 now covers both file-based and inline-comment suppressions. Hooks honor legitimate inline directives without becoming soft. `check-no-direct-spawn` and `check-no-placeholders` bypass wiring deferred to a follow-up (no catalog INV for direct-spawn; placeholder hook uses incompatible JSON env-var convention). INV-36 hardness-sentinel tests lock in the guarantee that all modified hooks still block on violations without a valid directive.

---

## ADR-038: Add commitlint.config.js.ejs template and wire into root generator (#202)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #202

**Context:** `src/generators/githooks.ts` emits `commit-msg` and `pre-push` hooks to target projects that reference commitlint, but no `commitlint.config.js.ejs` template existed. Generated target projects were referencing commitlint without shipping the configuration file that defines the ruleset.

**Decision:** Add `src/templates/root/commitlint.config.js.ejs` with a static `@commitlint/config-conventional` config (no EJS variables — pure static content). Wire emission via `src/generators/root.ts` for all projects (no language or governance gate) using `skipIfExists: true` for brownfield safety. Add CANON-04-required render test at `__tests__/templates/commitlint-render.test.ts` and CANON-05-required generator tests in `__tests__/generators/root.test.ts`.

**Consequences:** All generated target projects now receive a `commitlint.config.js` that correctly configures the commit-msg hook already emitted by githooks.ts. Brownfield projects with a custom config are unaffected (skipIfExists). Gate passes with no regressions.

---

## ADR-037: Batch gap-fill #127–#161 — publicApiSurface, static hooks, L3 fixtures, unused-exports, formatter configs, frontend-spa boundaries, Go mutation omission, classify-changes L2

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #127, #151, #153, #156, #157, #158, #160, #161

**Context:** Bulk sweep of issues #127–#161. #154 and #155 were already shipped (closed as superseded). The remaining 8 issues covered gaps across five categories: (1) missing publicApiSurface metric in `debt-lib.mjs.ejs`; (2) `check-no-placeholders` and `check-no-unused-exports` hook templates not emitted; (3) L3 governance level absent from 15 real-project fixture manifests; (4) missing `rustfmt.toml` for Rust and `gofmt -l` gate for Go; (5) frontend-spa archetype lacking ESLint import-boundary enforcement; (6) no test asserting Go projects never emit a mutation gate; (7) `classify-changes` CI job gated on L3-only, leaving L2 single-lane projects without change-set awareness.

**Decision (per issue):** #127 — add `<% if (metricsProfile.includePublicApiSurface) %>` block in `debt-lib.mjs.ejs` using `grep -rh ^export` to count exported symbols; scoped to `library` archetype. #151 — add `check-no-placeholders.mjs` as a language-agnostic static hook (always emitted); direct-spawn hook deferred (no catalog INV). #153 — add `"L3"` to `levels` in all 15 fixture manifests that lacked it. #156 — add `check-no-unused-exports.mjs` (knip-based) emitted for TypeScript only, with `.mts`/`.cts` extension guard and graceful ENOENT skip. #157 — emit `rustfmt.toml` (edition + max_width 100) for Rust; add `gofmt -l .` runCheck to Go branch of `check-all.mjs.ejs`. #158 — extend `src/generators/boundaries.ts` to emit `.eslintrc-frontend-spa.cjs` for `frontend-spa` archetype with FSD (Feature-Sliced Design) layer ordering. #160 — add explicit test asserting Go `check-all.mjs` never references `go-mutesting` at any governance level. #161 — change `classify-changes` emission guard from `L3 || multiLane` to `!== L1 || multiLane` so L2 single-lane projects receive the job and its consumers wire correctly.

**Consequences:** debt-lib now tracks public API surface for library archetypes. Both new hook templates ship with all generated projects (placeholders) or TS projects (unused-exports). All 15 fixtures are L3-ready. Rust and Go projects now have formatter config/gate. frontend-spa projects enforce FSD layer import discipline. Go mutation omission is test-locked. L2 single-lane CI pipelines benefit from change-set-aware job skipping.

---

## ADR-039: Parallel test category jobs in CI (#219)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #219

**Context:** The generated `ci.yml` ran all tests in a single sequential `lint-and-test` job. Contract test failures (fast, ~2min) waited behind unit tests (~8min) for feedback. Splitting into parallel jobs reduces mean-time-to-feedback.

**Decision:** Split the TS and Java `lint-and-test` job into: `lint-and-test` (lint/typecheck only), `unit-tests`, `contract-tests` (parallel with unit), `integration-tests` (needs unit), `behavioral-tests` (needs unit). The `ci-required` aggregator waits for all. `check-all.mjs.ejs` L1 uses `npm run test:unit`; L2 runs all categories. `injectTestScripts()` in `debt-gates.ts` adds `test:unit/contract/integration/behavioral` scripts to target package.json.

**Consequences:** Target projects gain parallelized feedback. The `test:unit` script isolates fast-only tests from slower integration/behavioral suites.

---

## ADR-055: SpotBugs security hard-block baseline script (#212)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #212, INV-44

**Context:** Java projects generated by arbiter previously had no mechanism to prevent SpotBugs security-category findings (SQL_INJECTION, XSS, COMMAND_INJECTION, XXE, LDAP_INJECTION, HARD_CODE_PASSWORD) from being silently baselined. The `spotbugs.gradle` was emitted but no script enforced the invariant that security bugs must never be suppressed.

**Decision:** Add `scripts/verify-spotbugs.mjs.ejs` template — a Node.js script emitted to Java target projects. It enforces a `SECURITY_HARD_BLOCK` set that causes `process.exit(1)` even when `--update-baseline` is passed. Non-security findings may be baselined in `spotbugs-baseline.json`. Wire the script into `check-all.mjs.ejs` L2 Java path. Codify as INV-44 (security tier, Java-only) in the invariant catalog and AGENTS.md.

**Consequences:** Java projects cannot silence security-class SpotBugs findings via baseline. The `--update-baseline` flag correctly updates non-security baselines while blocking security ones. Gate failures for security findings are immediate and unconditional.

---

## ADR-036: Forensic fixes F9–F12 (issues #368–#371, from umbrella #344)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #368, #369, #370, #371

**Context:** Audit wave #344 surfaced four additional governance gaps: F9 — PMD `UnusedPrivateField`/`UnusedPrivateMethod` were unconditionally excluded (DI-pattern alibi no longer needed with file-based suppressions); F10 — Rust integration testing scaffold used `panic!` on missing `DATABASE_URL` instead of real testcontainers-rs setup, and the cargo invocation used an invalid `--test '*integration*'` glob (cargo doesn't support shell globs in `--test`); F11 — `generateArchUnit` accepted unknown `architectureStyle` values silently and the `ArchitectureTest.java.ejs` else-block emitted only a comment (silent vacuous green in test suite); F12 — PIT mutation testing templates did not set `failWhenNoMutations = true`, so a project with zero mutatable classes passed the mutation gate silently.

**Decision:** F9: Remove both UnusedPrivate excludes from `pmd-ruleset.xml.ejs` — legitimate DI suppressions belong in file-based `suppressions/pmd-suppressions.xml`. F10: Rewrite `db_fixture.rs.ejs` to use `testcontainers::clients::Cli` + `GenericImage` with `WaitFor::message_on_stderr`; add `appendCargoDevDep` helper in `integration-testing.ts` that idempotently appends `testcontainers = "0.23"` to `[dev-dependencies]`; fix cargo integration test invocation to `['test', '--tests']`. F11: Add a `KNOWN_STYLES` guard in `generateArchUnit` that throws on unrecognised style; replace the silent else-block in `ArchitectureTest.java.ejs` with a `@Test` method calling `Assertions.fail(...)`. F12: Add `failWhenNoMutations = true` to both `pitest.gradle.ejs` and `pitest-maven-setup.md.ejs`.

**Consequences:** All four gaps closed. PMD now flags unused private members by default. Rust integration tests use real container isolation. ArchUnit generator fails loud on misconfiguration at both generator level (throw) and runtime (failing test). PIT gate fails when no mutations exist, closing the silent-vacuous-green path.

---

## ADR-056: Self-dogfood check for EJS templates (#239)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #239, INV-45

**Context:** arbiter generates `.claude/` configuration files from EJS templates under `src/templates/claude/`. Over time, the materialized `.claude/` files in the arbiter repository diverged from their template sources (extended with arbiter-specific hooks, batch workflow commands, CI runner notes). There was no automated check to detect this drift, risking template degradation where future improvements to the materialized files would not be back-ported to the templates shipped to target projects.

**Decision:** Add `scripts/check-self-dogfood.mjs` — a Node.js script that renders every EJS template under `src/templates/claude/` with arbiter's own config (read from `arbiter.json`), normalizes both rendered and materialized content via Prettier, and diffs them line by line. Files with intentional divergences are registered in `.dogfood-divergences.json` with documented reasons. Config-gated templates (e.g. `guard-done-evidence.mjs` when `evidenceHarness=false`) are skipped. Wire the check into `scripts/check-all.mjs` L2 block. Codify as INV-45 (governance tier, alwaysActive) in the invariant catalog and AGENTS.md.

**Consequences:** Future template modifications will be caught at L2 gate if the corresponding materialized file diverges without a documented reason in `.dogfood-divergences.json`. Intentional arbiter-internal extensions remain explicitly documented. The check prevents silent template drift in both directions.

---

## ADR-040: Hook audit + anti-bloat discipline (CANON-16)

**Date:** 2026-05-12
**Status:** Accepted
**Reference:** Audit 2026-05-12

**Context:** Audit of all 18 active Claude Code hooks revealed three weaknesses: (1) `post-commit-check.mjs` exited 0 (warning-only), making conventional commit enforcement advisory despite commitlint already running in the L1 gate; (2) `check-no-unused-exports.mjs` ran a full-project knip scan (60s) on every TypeScript file edit, including test files and configs — the hook served no purpose outside `src/`; (3) no process rule required AI agents to survey existing code before creating new files, causing gradual bloat via redundant abstractions. The `guard-done-evidence.mjs` absence from settings.json was confirmed as correct: it is config-gated behind `evidenceHarness=true`, which arbiter itself does not declare. The `check-circular-deps.mjs` soft-skip was confirmed non-issue: madge is a declared devDependency.

**Decision:** (1) Upgrade `post-commit-check.mjs` to `process.exit(1)` — commits with non-conventional messages are now hard-blocked at the Claude Code hook level, consistent with the L1 commitlint gate. Template `src/templates/claude/hooks/post-commit-check.mjs.ejs` updated to match; adds guard for `git log` failure (non-git dirs) so the hook exits 0 when no commit is available to check. Empirical fire-tests updated: renamed "warning-only" test, added exit-1 and exit-0 cases with real git repos, added CANON-04 render test to `hooks-advanced-render.test.ts`. (2) Add early-exit to `check-no-unused-exports.mjs` when the edited file is not under `src/`; reduce timeout from 60s to 30s. Per CANON-14: `check-no-unused-exports.mjs.ejs` intentionally has no template — knip is a TypeScript-ecosystem meta tool that arbiter uses to self-govern, not a governance artifact emitted to target projects (which have their own coverage tools). (3) Add `.claude/rules/35-refactor-first.md` implementing CANON-16: every plan for new `src/` files must include an "Existing Code Survey" section. Add CANON-16 to `docs/SYSTEM/CANON.md`.

**Consequences:** Commit messages are enforced at two levels (hook + gate). Unused-export scan overhead reduced by ~80% for non-src edits (0ms vs 60s). Template parity for post-commit-check is now maintained (materialized hook = rendered template). AI agents must document refactoring-vs-creation decisions in plans, creating a paper trail and imposing cognitive friction that favors refactoring.

## ADR-041: Anti-bloat enforcement automation (INV-46)

**Date:** 2026-05-12
**Status:** Accepted
**Reference:** Issue #458; ADR-040

**Context:** ADR-040 introduced CANON-16 (Refactor-First Rule) as a prose rule enforced only at human review time. The rule required an "Existing Code Survey" in every plan that creates `src/` files, but nothing prevented an agent from bypassing it. Three additional enforcement gaps: (1) no automated duplication detector caught near-identical functions across `src/generators/` (40+ files) or `scripts/`; (2) no file-count or LOC ceiling existed — `src/templates/` had grown to 225+ files without a metric ceiling; (3) `src/templates/` could not be scanned by jscpd (EJS syntax), so a tighter per-bucket ratchet was needed to compensate.

**Decision:** Four enforcement layers (INV-46):

- **L1 — Survey gate**: `pre-edit-plan-anchor.mjs` hard-blocks (exit 2) any `Write` to a new `src/` file if the active plan lacks a valid `## Existing Code Survey` block matching that file's exact relative path. Deterministic parse (h2-section split) — not regex theater. Block requires: Target anchor, Decision keyword (one of six), ≥3 grep/ls evidence rows, ≥200 non-whitespace-char Rationale. Bypass: `ARBITER_PLAN_BYPASS=1`. Scope: all new `src/` files, excluding `__tests__/`, `*.test.*`, `*.spec.*` (EJS templates are NOT excluded — they count as `src/` scope).
- **L2 — Duplication**: `jscpd` (threshold 5%, minTokens 50). `src/templates/**` excluded — EJS variants across 20+ language stacks intentionally share scaffolding; scanning erodes signal. `eslint-plugin-sonarjs`: `no-identical-functions: error`, `no-duplicate-string: warn` scoped to `src/**/*.ts`.
- **L1 — Bloat ratchet**: `check-bloat-ratchet.mjs` measures 4 disjoint buckets: (a) `src/` direct children only, (b) `src/generators/`, (c) `src/commands/`, (d) `src/templates/`. Default threshold: +10% or +5 files per bucket. `src/templates/` tighter: +5% or +3 files (compensates for jscpd exclusion). Bypass: `ALLOW_BLOAT=1` env var (not commit footer — L1 runs pre-commit; no commit exists yet). Baseline advanced with `node scripts/update-bloat-baseline.mjs --task=#NNN`.
- **L4 — Doctrine**: `senior-survey` skill emits canonical parseable Survey block; `task.md` + `review-plan.md` updated with Survey template; INV-46 in catalog; this ADR.

**Design choices:**

- _Structured-block parse vs regex_: The skill emits a canonical block with exact anchor text; the hook validates by h2-section split + field extraction. Regex on free-form text is easy to fool by coincidental match; section-split is deterministic and survives whitespace variation.
- _ALLOW_BLOAT env var vs commit footer_: L1 gate runs in `pre-commit` context before a commit exists; commit-footer bypass (`ALLOW_BLOAT=true`) is unreachable at that point. Env var is the correct surface.
- _CANON-01/14 generated-project exemption_: The Survey hook is arbiter's internal harness. Generated projects receive CANON-16 doctrine (`.claude/rules/35-refactor-first.md`) but NOT the hook validator — generated projects have different plan file conventions and the hook would false-positive on their plans. Divergence documented in `.dogfood-divergences.json`.
- _jscpd first-run_: Current codebase duplication is 1.55% (well below 5% threshold) — no grace period required. Baseline runs cleanly on the PR that ships the check.

**Consequences:** New `src/` file creation requires a documented survey — agents can no longer silently add files. Duplication above 5% blocks L2. File/LOC growth above per-bucket thresholds blocks L1. Total bypass surfaces: two session-scoped env vars, both documented in CONTRIBUTING.md. `src/templates/` gets tighter ratchet to compensate for jscpd exclusion.

---

## ADR-057: V1 Verification Bridge (#253)

**Date:** 2026-05-13
**Status:** Accepted
**Reference:** Issue #253; ADR-039

**Context:** Plans submitted to arbiter lacked machine-readable invariant checks. Human review missed Italian UI strings, skipped tests, orphan TODOs, and out-of-scope drive-by files. A CLI-only bridge (per ADR-020) was needed to gate plan merges deterministically.

**Decision:** Add `arbiter verify plan <file>` command implementing 4 rules: VB-INV-EN-UI (Italian stopword check on UI strings), VB-INV-NO-SKIP (skip pattern detection in test files), VB-INV-NO-ORPHAN (TODO without task reference), VB-INV-NO-DRIVEBY (files outside declared scope). Zod validates PlanJsonV1 schema on input. Results written to `.arbiter/plan/REVIEW.json` (pointer) and `.arbiter/plan/runs/<runId>/REVIEW.json` (archive). Exit 0 = APPROVED/SKIPPED; exit 2 = REJECTED/ERROR. Plugin field `verifyPlanRules` allows rule injection; duplicate IDs produce REGISTRY ERROR. `review_bridge.enabled:false` short-circuits to SKIPPED for incremental adoption.

**Consequences:** Plan files violating the 4 invariants are blocked before merge. Archive is append-only per run. Plugin rules extend without forking the binary. No MCP surface added.

---

### ADR-042 — Four-Pillar SSOT Infrastructure (AC#1 Deviation)

**Status:** Accepted
**Reference:** Issue #255; INV-47..INV-50

**Context:** Issue #255 (AC#1) named `src/generators/ssot-four-pillar.ts` as the implementation target for the four-pillar production baseline SSOT model (Authority / Routing / Aliasing / Gates). However, `src/generators/ssot.ts` already emits three of the four pillars via a clean dispatch over `ProjectConfig.governanceLevel`. Adding a fourth pillar (CANONICAL_PATHS) is a one-line extension to the existing `files.push(...)` loop.

**Decision:** Extend `src/generators/ssot.ts` rather than create a new `ssot-four-pillar.ts` file. CANON-16 forbids new files when a refactor of an existing module is viable. The deviation from AC#1's naming is documented here per CANON-01.

**Design choices:**

- _CANONICAL_PATHS uses `skipIfExists`_: Like KNOWLEDGE_MAP, alias entries accumulate manual edits over time. Re-running `arbiter init` must not clobber user-defined redirects.
- _Four gates as L1 checks_: INV-47 (ssot-core), INV-48 (doc-links), INV-49 (knowledge-map), INV-50 (canonical-paths) are all wired into the L1 block of `check-all.mjs`. Bootstrap mode (missing SSOT files) exits 0, so fresh projects are not blocked before the SSOT files are populated.
- _CANON-01 dual-sided_: Each gate ships as both an arbiter-self script (`scripts/check-X.mjs`) and an emitted template (`src/templates/scripts/check-X.mjs.ejs`) for target projects.
- _`arbiter harness --fast`_: CLI command wrapping the four gates for target project use. `--fast` stops at first failure; without the flag all four run and all failures are reported.

**Consequences:** The production baseline four-pillar model (Authority / Routing / Aliasing / Gates) is fully realised in both arbiter-self and generated target projects. Moved/renamed docs no longer silently break links (CANONICAL_PATHS + check-canonical-paths). Missing SSOT entries are detected at L1 (check-ssot-core). KM line count drift is detected at L1 (check-knowledge-map). All four gates bootstrap safely on new projects.

---

## feat(#247): gate script consolidation — inline workflow-runners and ci-alignment into check-all.mjs.ejs (2026-05-13)

**Status:** Accepted
**Reference:** Issue #247; CANON-04, CANON-05

**Context:** The generator `generateCheckAll` emitted three separate files: `check-all.mjs`, `check-workflow-runners.mjs`, and `check-ci-alignment.mjs`. This violated the principle that the gate manifest should be self-contained: target projects received three loose script files, two of which were only ever invoked via `runCheck(...)` from the third.

**Decisions:**

- **Templates deleted**: `src/templates/scripts/check-workflow-runners.mjs.ejs` and `src/templates/scripts/check-ci-alignment.mjs.ejs` removed. Generator now emits ≤1 gate script per project.
- **Logic inlined**: Workflow-runners check uses `_wr`-prefixed variables; ci-alignment check uses `_ca`-prefixed variables. Both are IIFE-style blocks that push `{name, status, elapsed}` to `results[]` and increment `failed` on violation, consistent with the existing Go/BDD inline patterns.
- **No `gitleaks` case in `_caNormalizeKey`**: The standalone `check-ci-alignment.mjs.ejs` had `case 'gitleaks': return 'gitleaks'`. This was dropped from the inline helper because the ci-alignment checker never needs to track gitleaks as a manifest gate — both sides return `null`, so no spurious mismatch is produced. The gitleaks step is guarded by `enableSecurityScanning` at the EJS level; the ci-alignment inline logic must be gitleaks-free to not pollute renders where `enableSecurityScanning=false`.
- **`readdirSync` added** to the `node:fs` import in `check-all.mjs.ejs` to support the inline workflow-runners directory scan.
- **Baseline updated**: Template-tests baseline updated from 128 → 127 (two templates removed, no new template added).

**Consequences:** Each generated project receives a single `scripts/check-all.mjs` that self-contains all L1 gate logic. The two formerly-separate scripts are no longer emitted, reducing surface area and eliminating the risk of accidental deletion of a "helper" script that breaks the gate.

---

## feat(#248): hook dispatcher pattern — single entry point per event (#248) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #248; CANON-04, CANON-05, CANON-14

**Context:** Generated `.claude/hooks/` directories contained up to 17 separate hook files, each registered individually in `settings.json`. This created maintenance overhead (17 command entries per settings.json, per-hook conditional registrations in the EJS template) and made brownfield upgrades fragile — new hooks required both a new file AND a new settings.json entry.

**Decisions:**

- **`hooks.mjs.ejs` dispatcher template added**: A single entrypoint template emits `hooks.mjs` for every generated project. The file contains a `HANDLERS` config table mapping `"EventType:Matcher"` keys to ordered arrays of handler filenames. Handlers run sequentially via `spawnSync`; first non-zero exit aborts the chain. stdin is buffered once and forwarded to every handler that may need it.
- **`settings.json.ejs` consolidated**: Instead of registering 4–10 individual hook commands per event, each event+matcher now registers one command: `node .claude/hooks/hooks.mjs <EventType:Matcher>`. This reduces the settings.json hook surface from 10–14 entries to 6 (one per event/matcher combination).
- **EJS conditionals preserved in dispatcher**: `hooks.mjs.ejs` uses the same `language`, `governanceLevel`, `enableSecurityScanning`, `enableEvidenceHarness`, and `languageHooks` variables to conditionally include handler names — language/governance gating moves from settings.json into the dispatcher config table.
- **Brownfield upgrade**: `mergeSettingsJson` updated to recognise the dispatcher pattern — when incoming entry has `hooks.mjs`, all previously arbiter-managed hook basenames are removed from the existing entry before the dispatcher is added. Non-arbiter custom hooks are preserved.
- **`ARBITER_HOOK_BASENAMES` constant** added to `src/utils/fs.ts` — exhaustive list of all hook basenames arbiter may emit; used by the merge logic to distinguish arbiter-managed from user-custom entries.
- **INV-48 baseline unchanged** (127): the new `hooks.mjs.ejs` template is covered by `__tests__/templates/hooks-dispatcher-render.test.ts`.
- **Manifest updated**: `hooks.mjs.ejs` added to `.arbiter/hooks-manifest.json` with classification `ADVISORY` (the dispatcher itself is advisory; individual handlers carry their own HARD/ADVISORY classification).

**Consequences:** Generated projects have a single dispatcher registered per event in settings.json. Adding or removing a handler requires editing `hooks.mjs` only (not settings.json). Brownfield projects that already have arbiter-managed hook entries are upgraded cleanly on the next `arbiter init` run. The 17-file hook surface is preserved on disk (individual handlers still emitted) but the registration surface collapses to 6 entries.

---

## feat(#254): context-pack generator + two-phase checker (P7 primitive) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #254; CANON-04, CANON-05, CANON-11

**Context:** Issue #253 (V1 verification bridge) established a `verify plan` CLI but had no structured way to produce the two-input bundle (CONTEXT_PACK.md + plan.json) that the two-phase checker consumes. Without a deterministic generator, the "plan review" workflow required manual file assembly — fragile and not repeatable.

**Decisions:**

- **`src/context-pack/` module created**: Three files — `generator.ts` (core deterministic generator), `track-mapping.ts` (A/B/C/D track → INV-set mapping), `review-context.ts` (Zod schema + `combinedVerdict()` function for two-phase checker output aggregation).
- **Track-to-INV mapping is SSOT**: `track-mapping.ts` maps each governance track (A/B/C/D) to the INV IDs that must be checked; generator and checker both import from this single source rather than duplicating the list.
- **Deterministic output guaranteed**: Generator sorts all file/INV lists alphabetically and uses no `Date.now()` or random values. Fixture tests verify that tracks A and B produce different but stable output.
- **`fromPlanJson()` adapter**: Bridges `PlanJsonV1` (emitted by `verify plan`) → `ContextPackInput`; allows the end-to-end flow (`verify plan` → `generate context-pack`) without a separate CLI flag.
- **`writeContextPackFile()` wrapper**: Writes `CONTEXT_PACK.md` to a project root; used by the generator CLI step and tested via brownfield fixture.
- **Agent templates added**: `context-checker.md.ejs` and `bridge-reviewer.md.ejs` emitted under `.claude/agents/` for generated projects; wired into `agents-claude.ts` generator; dogfooded into arbiter's own `.claude/agents/`.
- **`contextPack.adrMappings` schema field**: Optional config key maps ADR IDs to INV IDs, allowing the checker to cross-reference plan ADR citations against the INV catalog. Validated by `validateContextPack()`.

**Consequences:** `arbiter verify plan` can now produce a fully-structured `CONTEXT_PACK.md` bundle consumed by the two-phase checker agents. The track→INV mapping is version-controlled and enforced. All four acceptance criteria (deterministic generator, track-INV mapping, ADR mapping config, combined-verdict schema) are covered by tests.

---

## feat(#264): cross-repo governance compare (`arbiter compare`) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #264; CANON-06, CANON-16

**Context:** Organisations with multiple repositories governed by arbiter need a way to compare governance postures across repos — identifying where the same invariant is enforced differently, where an INV is present in one repo but not another, and where the risk-tier assignment diverges. Without tooling, these comparisons must be done manually.

**Decisions:**

- **Five detector types**: `divergent-enforcement` (same INV id, different gates), `contradictory-adr` (same ADR id, conflicting titles), `promotion-asymmetry` (INV present in ≥1 real graph repo, absent in others), `unique-to-one-repo` (INV only in one non-fallback repo), `risk-class-divergence` (same INV, different tier across repos).
- **Wave-1 degradation**: Only INV+GATE nodes exist in the graph today. ADR contradiction detection is wired but will produce findings only once an ADR builder is added. Fallback repos (no graph.json) use the global INVARIANT_CATALOG — they suppress promotion-asymmetry noise by the `fromFallback` flag.
- **Workspace YAML**: Parsed by a hand-rolled scanner (no runtime YAML dep). Supports `name`, `repos[].path`, `repos[].role`, `repos[].tier`. Full YAML is out of scope.
- **`--fail-on contradiction`**: Exits 1 when `contradictory-adr` findings are present. `--fail-on divergence` exits 1 on divergent-enforcement or risk-class-divergence. `--fail-on any` exits 1 on any finding.
- **Shared loader**: `src/graph/load.ts` extracted from `trace.ts` to avoid a third copy of the parse-snapshot pattern.
- **CANON-16 survey**: No existing `compare` or `cross-repo` command found; `src/compare/` directory is a new responsibility (multi-repo analysis) with no overlap with existing commands.

**Consequences:** `arbiter compare path/a path/b` loads graphs, runs all five detectors, and returns structured findings. `--format report.md` writes a markdown report. `--fail-on` enables gate mode. Graceful degradation when a repo has no graph.

---

## feat(#265): AI agent constitution export (`arbiter agent-rules`) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #265; CANON-06, CANON-16

**Context:** Governance rules captured in the provenance graph need to be surfaced to AI coding agents in their native formats. Without an export command, teams must manually maintain `.cursorrules`, `copilot-instructions.md`, etc. — these drift from the source of truth over time.

**Decisions:**

- **Intermediate format**: A target-agnostic JSON struct (`AgentRulesIntermediate`) with `schemaVersion`, `repo`, `invariants[]`, and `workflows[]`. Each invariant carries `severity` derived from tier (architectural/security/governance → `hard-stop`; data/operational → `advisory`). This decouples graph traversal from emitter logic.
- **Severity mapping**: `tier ∈ {architectural, security, governance}` → `hard-stop` (MANDATORY); `tier ∈ {data, operational}` → `advisory` (RECOMMENDED). Documented here as the single source of truth.
- **Five emitters**: `claude` (`.claude/AGENT_RULES.md`), `cursor` (`.cursorrules`), `copilot` (`.github/copilot-instructions.md`), `aider` (`CONVENTIONS.md`), `windsurf` (`.windsurfrules`). Each is a pure function over `AgentRulesIntermediate`.
- **`arbiter agent-rules verify`**: Renders a fresh export and byte-compares against the on-disk file. Missing file → ok (not yet exported). Stale → exit 1.
- **Fallback**: No graph.json → uses INVARIANT_CATALOG via `buildInvNodes`. `fallbackUsed` flag returned to callers.
- **`applies_to` field**: Stubbed as `[]` in Wave-1 (no FILE→INV edges yet). Forward-compatible: a future FILE builder will populate it.
- **CANON-16 survey**: Grepped for existing `agent-rules`, `constitution`, `export --target` patterns in `src/commands/`. None found. `src/agent-rules/` directory justified as a distinct concern (AI agent constitution derivation) separate from `src/generators/` (project scaffold generation).

**Consequences:** `arbiter agent-rules export --target <X>` renders governance rules for any supported AI tool. `--all` writes all targets to standard paths. `verify` enables drift detection in CI.

---

## ADR-058: Context-economy rule + knowledge-map + track-aware post-commit (#720, #724)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issues #720 (M-12), #724 (M-16); prior-art baseline ports FINDINGS.md#mech-M-12, #mech-M-16

**Context:** The prior-art baseline ships `rules/10-knowledge-map.md` (prose context-economy rule) and `hooks/post-commit-check.sh` (track-aware checklist). arbiter had scattered context-economy guidance but no explicit rule, no machine-readable routing map, and no track routing in `post-commit-check.mjs`. The issues require porting AND improving over the production baseline.

**Decision:**

- **`40-context-economy.md` rule** (static Markdown, no EJS): generated as `.claude/rules/40-context-economy.md` via `generateClaudeRules`. Defines minimum startup set (AGENTS.md + KNOWLEDGE_MAP.md + knowledge-map.json) and a track routing table (frontend/backend/docs). `skipIfExists: true` — user-customizable.
- **`knowledge-map.json`** (EJS): generated as `.claude/knowledge-map.json` from `claude/knowledge-map.json.ejs`. Injects `projectName` and `lanes` (detected at init time). Contains `tracks` object with signal paths + required/optional docs per track, plus `minimum_startup_set`. `skipIfExists: true`.
- **`pre-task-track-detect.mjs`** (EJS): generated as `.claude/hooks/pre-task-track-detect.mjs`. UserPromptSubmit hook — detects task track from `git diff --name-only HEAD` + prompt keywords; writes routing hint to stdout (non-blocking, always exits 0). Added to hooks-manifest.json as ADVISORY. `skipIfExists: true`.
- **`post-commit-check.mjs.ejs` extension** (#724): appended track-detection block after the existing INV-22 conventional commit check. Reads `git diff --name-only HEAD~1 HEAD`, classifies changed files into frontend/backend/docs tracks, and writes per-track checklist hints to stdout. Non-blocking. Graceful skip when HEAD~1 unavailable (first commit).
- **CANON-16 surveys**: `generateClaudeRules` — existing array-driven pattern extended with one new entry; no new file. `generateClaudeHooks` — existing hook-loop pattern extended inline. `knowledge-map.json` — grepped `src/templates/claude/` for similar machine-readable config; none found. New EJS template justified as distinct concern (track routing, not hook or settings).

**Consequences:** Target projects gain: (1) explicit context-economy rule in Claude rules; (2) machine-readable track routing consumable by hooks and agents; (3) UserPromptSubmit hint before every task that touches track-specific files; (4) post-commit per-track checklist guidance. `post-commit-check.mjs` content change is a template extension — existing installations with `skipIfExists: true` will not auto-update until arbiter re-init.

**Completion (#724, 2026-05-17):** Issue #724 finishes the stub-grade track-detection block. Changes: (1) `scripts/detect-track.mjs` — shared lib exporting `detectTracks(files)` and `TRACK_PATTERNS` as the canonical single source of truth; (2) 15 EJS partials at `src/templates/claude/hooks/post-commit-checklists/<stack>/<track>.ejs` — per-stack × per-track advisory text (TS/Java/Go/Python/Rust × frontend/backend/docs) baked into generated hooks at `arbiter init` time via EJS `include`; (3) `post-commit-check.mjs.ejs` updated — inline detection gains CRLF normalization, checklists replaced by stack-specific EJS partials; (4) `.claude/hooks/post-commit-check.mjs` (self-config) updated — inline detection replaced by dynamic `await import()` of `scripts/detect-track.mjs` wrapped in try-catch (RT-EH-001: static ESM import on a missing module crashes all commits). Architecture: 15 EJS files are render-time content partials (Option A), not independent hooks — eliminates the dispatcher-registration problem (RT-AR-001). See `docs/SYSTEM/POST_COMMIT_TRACKS.md` for taxonomy and extension guide.

## ADR-042: Rust context-aware INV-04 checkers + rebased-aware docs-check (#360, #356)

**Date:** 2026-05-14
**Status:** Accepted
**Reference:** Issues #356, #360 (from umbrella #344); CANON-01, CANON-02

**Context:** Two Phase 7 gaps from haben-parity audit. **#360 (Phase 7H):** haben ships `inv-20-no-unwrap.sh` and `inv-04-no-unsafe.sh` shell scripts that use awk to take a context-aware production slice of Rust source (everything before the first `#[cfg(test)]` line), skip `lib.rs` (re-export entrypoint), filter comment lines, and HARD-fail on `.unwrap()`/`.expect(...)`/`unsafe`. arbiter's clippy-only gate caught the keyword but not the production-vs-test context — `unwrap()` inside `#[cfg(test)]` modules was incorrectly flagged. **#356 (Phase 7D):** the existing `scripts/check-docs.mjs` used a strict-linear `origin/main..HEAD` range that mis-classifies rebased branches (sees main commits replayed underneath) and offered no escape hatch for intentional non-doc commits.

**Decision:**

- **#360 Rust checkers**: Two new templates `src/templates/scripts/checks/check-rust-no-unwrap.mjs.ejs` and `check-rust-no-unsafe.mjs.ejs` — Node.js (not awk) for cross-platform portability (Windows targets). Logic mirrors haben's awk pipeline: walk `src/**/*.rs`, skip `lib.rs`, slice production code before the first `#[cfg(test)]` line, strip comment-only lines, HARD-fail on `.unwrap()`/`.expect(`/bare `unsafe` (with `forbid|deny|allow(unsafe_code)` lint declarations excluded). Emission gated in `generateCheckAll` on `language === 'rust'`. Wired at L1 in `check-all.mjs.ejs` rust block.
- **#356 docs-check refactor**: New template `src/templates/scripts/check-docs.mjs.ejs` plus refactor of live `scripts/check-docs.mjs` (CANON-01 dual-declination). Diff range now resolved via `git merge-base HEAD origin/main` with fallback to plain refs. Bypass: any commit message in the range containing `[skip-docs]` causes the gate to PASS. CI `docs-check` job in `ci.yml.ejs` updated identically to use merge-base + honor `[skip-docs]`.
- **CANON-16 surveys**: #360 — grepped `src/templates/scripts/` for similar Rust-specific gates; none found. `src/templates/scripts/checks/` justified as a new namespace (language-specific gates, distinct from universal SSOT gates under `src/templates/scripts/`). #356 — `scripts/check-docs.mjs` exists at root; refactored in place to add merge-base + `[skip-docs]` rather than fork. No template existed under `src/templates/scripts/`; new file justified by CANON-01 dual-declination requirement (self-applied gate must also be templated for target projects).

**Consequences:** Rust target projects gain context-aware INV-04 enforcement that does not false-positive on test modules. arbiter's own docs gate (and the gate emitted to L2+ target projects) tolerates rebased branches and offers a documented `[skip-docs]` escape hatch for legitimate non-doc commits (typo fixes, dependency bumps). Behavior shift for arbiter contributors: the live `scripts/check-docs.mjs` semantics change from `origin/main..HEAD` (linear) to `merge-base HEAD origin/main` (rebased-aware); anyone relying on the old strict-linear behavior should rebase or use `[skip-docs]`.

---

## ADR-059: selfOnly invariant field — filter arbiter-internal rules from generated target AGENTS.md (#682)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #682 (from sweep #277 finding #12)

**Context:** Several invariants in `src/invariants/catalog.ts` describe arbiter's own development discipline — matrix fixtures, EJS template coverage, dogfood checks, hook fire-tests, etc. With `alwaysActive: true`, these invariants were written into every generated target-project `AGENTS.md` and `GLOBAL_INVARIANTS.md`. A Python backend project receiving "every 'proven' language must have a nightly real-project fixture" (INV-32) is confused by a rule that only makes sense inside the arbiter repo.

**Decision:** Add `selfOnly?: boolean` to the `Invariant` interface. Mark 11 arbiter-internal invariants: INV-32 (matrix fixtures), INV-36 (hook hardness manifest), INV-39 (hook fire-tests), INV-45 (self-dogfood), INV-46 (anti-bloat enforcement), INV-47 (matrix proven cell wiring), INV-48 (EJS template test coverage), INV-49 (generator tests), INV-50 (command tests), INV-51 (catalog/AGENTS parity), INV-52 (enforcement wiring). Add `includeArbiterInternal?: boolean` to `getFilteredInvariants` config — default `false` (target-project context excludes selfOnly). Arbiter's own test suite passes `includeArbiterInternal: true` to verify full catalog counts.

**CANON-08 survey:** grepped `src/invariants/types.ts` for existing sentinel fields — found `status`, `redirectTo`. `selfOnly` is distinct: not a lifecycle state, not a redirect, but a generation-context filter. Justified as new field.

**Consequences:** Generated AGENTS.md for target projects no longer contains arbiter-internal invariants. Catalog count tests updated (TS+L3+all: 57→46, Java+L2+all: 56→45, Java+L3+all: 59→48). New tests verify default exclusion and opt-in inclusion.

---

## ADR-060: alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #683 (from sweep #277 finding #13)

**Context:** Three related ambiguities were discovered during sweep #277:

1. The `alwaysActive` JSDoc said "True for Tier 1 and Tier 5" but the field is also used on Tier 3 security invariants (INV-11/12/13) and an architectural Java-only rule (INV-29).
2. `filter.ts` applies `meetsGovernanceLevel` before the `alwaysActive` bypass, making INV-11 (`alwaysActive: true, minGovernanceLevel: L2`) invisible at L1 — contradicting the "always" mental model.
3. INV-29 (NoMockMvc, `alwaysActive: true`) vs INV-30 (mutation/PITest, `alwaysActive: false, minGovernanceLevel: L2`) are both Java-only test-infra rules with no documented asymmetry rationale.

**Decision:**

**1. JSDoc fix — not rename.** The `alwaysActive` field is renamed to `tierBypassOnly` in the issue suggestion. After evaluating the ripple (61 catalog entries, graph fixtures, test assertions), we keep the name `alwaysActive` and fix only the JSDoc to accurately state: "Bypasses the invariantTiers filter only; `minGovernanceLevel` is still enforced." A comment is added to the filter to reinforce the ordering invariant.

**2. INV-11/12/13 at L2+ with `alwaysActive: true` is correct.** These security invariants (secrets scan, PII scan, dep audit) require `minGovernanceLevel: L2` because the tooling setup (gitleaks, pip-audit, OWASP) is non-trivial and inappropriate for L1 projects. `alwaysActive: true` means only that they are not excluded by the `invariantTiers` preset — a project on L2 with 'essential' preset still gets them. They remain invisible at L1, which is the intended behavior.

**3. INV-29/30 asymmetry is intentional.** INV-29 (Java — never use MockMvc in unit tests) is an architectural constraint with zero setup cost. It should apply even at L1 governance where quality bars are low — bad test practices are equally bad at any level. INV-30 (Java — mutation testing with PITest) requires a dedicated CI job, slow test runs, and a passing threshold. It is appropriate only at L2+ where the project has invested in deep quality gates. The asymmetry in `alwaysActive` + `minGovernanceLevel` correctly captures this intent.

**Consequences:** No behavior change. JSDoc and filter comment updated for accuracy. Future contributors can reason clearly about `alwaysActive` without misreading it as "visible at all governance levels."

---

## ADR-063: check-no-skipped-tests hook (NI-11 enforcement) (#730)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #730 (extended-invariants NI-11); CANON-12

**Context:** The prior-art baseline's `GLOBAL_INVARIANTS.md` (line 89) bans `@Disabled`, `.skip`, `xit`, and commented-out tests. arbiter already enforced no-orphan-TODO and no-direct-spawn via post-edit hooks but had no equivalent for skipped tests.

**Decision:**

- New static hook template `src/templates/claude/hooks/check-no-skipped-tests.mjs` added to the `staticHooks` array in `generateClaudeHooks` — emitted to every target project unconditionally.
- Detection is extension-scoped: JS/TS files → `.skip(`, `.only(`, `xit(`, `xtest(`, `xdescribe(`; Java → `@Disabled`, `@Ignore`; Python → `@pytest.mark.skip/xfail`; Rust → `#[ignore]`.
- Wired in `hooks.mjs.ejs` dispatcher (PostToolUse:Edit|Write) and Codex `config.toml.ejs` adapter.
- Manifest entry added to `.arbiter/hooks-manifest.json` with HARD classification, spawnable fixture, and NI-11 rationale.
- **CANON-16 survey**: grepped `src/templates/claude/hooks/` for similar skip-detection hooks; none found. New file is distinct from `check-no-placeholders.mjs` (which blocks WIP tokens, not language-level test-skip APIs).

**Consequences:** All target projects initialised with arbiter will receive the `check-no-skipped-tests.mjs` hook. Committing a file containing `.skip(`, `@Disabled`, etc. will exit 1 before the commit is finalized. Developers must remove the skip or open a tracking issue before committing.

---

## ADR-064: Observability provider abstraction (#725)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #725 (wave:2-medium, provider-abstraction); CANON-04, CANON-05, CANON-11

**Context:** arbiter had no mechanism to emit observability bootstrap docs. Projects needed one-size-fits-all guidance or nothing. Different teams have wildly different observability stacks (self-hosted ClickHouse vs. SaaS APM vs. minimal stdout).

**Decision:**

- New optional `ObservabilityConfig` type (`provider`, `metrics`, `logs`, `traces`, `alerts`) added to `ProjectConfig`.
- `generateObservability` returns empty `files: []` when `observability` is absent or `provider === 'none'` — fully opt-in.
- Single unified template `src/templates/observability/setup.md.ejs` with per-provider conditional blocks. Avoids one-file-per-provider explosion (would have cost +9 template slots vs. +1 actual).
- All providers share the "Structured Logging Requirement" header requiring `traceId` on every log line (invariant satisfied unconditionally).
- Registry key `'observability'`; PATH_TO_KEYS entry `'observability.provider' → ['observability']` for selective re-runs.
- `skipIfExists: true` so user-customised docs survive `arbiter update`.

**CANON-16 survey:** grepped `src/generators/` for similar observability/monitoring generators — none found. Grepped `src/templates/` — no observability directory. New files justified.

**Consequences:** Projects that set `observability.provider` receive a complete, provider-specific setup guide on first `arbiter init`. Subsequent `arbiter update` does not overwrite custom edits.

---

## ADR-065: Auth provider abstraction (#726)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #726 (wave:2-medium, provider-abstraction); CANON-04, CANON-05, CANON-11

**Context:** Auth setup is the most variable aspect of a new project — it ranges from rolling your own session middleware to operating a full Keycloak cluster. Providing a single template would be either too opinionated or too generic to be useful.

**Decision:**

- New optional `AuthConfig` type (`provider`, `protocols`, `tenantIsolation`, `themeSync`) added to `ProjectConfig`.
- `generateAuth` returns empty `files: []` when `auth` is absent or `provider === 'none'` — fully opt-in.
- Single unified template `src/templates/auth/setup.md.ejs` with per-provider conditional blocks (10 providers: app-level-ts, authelia, authentik, ory-stack, zitadel, keycloak, saas-clerk, saas-auth0, saas-supabase-auth, saas-cognito).
- Email placeholders use `alice@<your-domain>` rather than `user@example.com` to pass the PII guard (INV-12).
- Registry key `'auth'`; PATH_TO_KEYS entry `'auth.provider' → ['auth']` for selective re-runs.
- Bundled with #725 in one PR (same wave, same structural pattern, same authoring cost).

**CANON-16 survey:** grepped `src/generators/` for auth/identity generators — none found. Grepped `src/templates/` — no auth directory. New files justified.

**Consequences:** Projects that set `auth.provider` receive a complete, provider-specific auth setup guide. Self-hosted stacks include docker-compose definitions; SaaS providers include SDK init and JWT validation patterns.

---

## ADR-066: Industrial-grade meta-preset (#729)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #729 (wave:1-immediate, M-tier); CANON-16

**Context:** After #710–#726 landed multiple governance features, activating them all required setting 7+ boolean flags and two nested config blocks. Teams evaluating arbiter need a single switch that matches the "Industrial Grade Certification" claims from the prior-art baseline README.

**Decision:**

- New `ProjectPreset = 'none' | 'industrial-grade'` type added to `src/wizard/types.ts`.
- `applyPreset(preset, config)` in `src/wizard/presets.ts` mutates ProjectConfig in place: sets all compliance/governance/operations flags + auth/observability scaffolding with provider `'none'`.
- Provider-override logic extracted to `applyPresetOptions` in `init.ts` to keep `runInit` complexity ≤15.
- `--preset`, `--auth-provider`, `--observability-provider` CLI flags added. No wizard prompts (CLI-only in this issue).
- Pre-existing schema gap fixed: `ArbiterConfigV2` now persists `observability?`, `auth?`, `preset?` through `arbiter.json` round-trips.
- Preset name stored in config for audit/drift detection.
- Features from open issues (#716 contract integrity, #718 evidence retention, #720 context economy) excluded from the preset until those generators land.

**CANON-16 survey:** grepped `src/wizard/` for similar preset/bundle logic — only `src/invariants/filter.ts`'s `presetToTiers()` exists (invariant-tier presets, different concept). New file `src/wizard/presets.ts` justified.

**Consequences:** Teams can activate the full compliance + governance stack with one flag. Auth and observability providers remain user-chosen to avoid lock-in. The preset is idempotent: re-running `arbiter update --preset industrial-grade` after changing a provider preserves the provider override.

## ADR-067: Worktree harvest parent-state guardrails (#733)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #733

**Context:** Issue #731 fixed the critical `git stash` data-loss bug (stash was being applied in the main repo's working tree, corrupting unrelated files). The fix replaced the stash-based copy with `cpSync` (no branch switches, no stash operations). #733 adds hardening-against-regression: a snapshot of the main repo's state before harvest, persisted to an audit log so any future regression is detectable.

**Decision:**

- **`captureParentState` option** added to `HarvestOptions`. When true, `harvestFiles` captures the main repo's current branch (`git rev-parse --abbrev-ref HEAD`) and its untracked files (`git status --porcelain=v1 -z --untracked-files=all`, filtered to `??` entries) before copying any files. Captured values are returned as `parentBranchBefore` and `parentUntrackedBefore` on `HarvestResult`.
- **Harvest audit log**: `runWorktreeClose` with `--harvest` or `--harvest-all` now writes one entry to `.arbiter/harvest-audit.log.json` per close operation. Entry fields: `taskId`, `worktreePath`, `harvestedAt`, `copied`, `skipped`, `parentBranchBefore`, `parentUntrackedBefore`. Format mirrors the existing close log (JSON array, append-only via `readJsonArray`/`writeJsonArray`).
- **Complexity budget**: Helper `writeHarvestAuditIfNeeded` extracted to keep `runWorktreeClose` under the ESLint complexity-15 threshold.

**Consequences:** Every `wt-close --harvest` leaves an audit trail in `.arbiter/harvest-audit.log.json`. If a regression ever causes the main repo's branch or untracked files to be mutated during harvest, the pre-harvest snapshot provides ground truth for debugging. No change to the copy logic itself — the `cpSync` path from #731 is unchanged.

**Addendum — untracked-file overwrite guardrail (#733):**

`git diff --quiet -- <file>` exits 0 for untracked files (no diff exists for a file git does not track), so `fileHasUncommittedChanges` previously returned `false` and harvest silently overwrote untracked files in the main repo. The fix adds `fileIsUntrackedInMainRepo` (probes `git ls-files --` — empty stdout = not tracked) and short-circuits before the copy when the destination exists but is untracked. Files blocked by this guardrail are collected in a new `HarvestResult.protectedUntracked` array and logged to the audit entry. The guard only fires when the destination file EXISTS — new files (no dest) continue to copy freely.

## ADR-068: Wizard Ctrl+C abort — exit 130, tmp cleanup, unified message (#621)

**Date:** 2026-05-17
**Status:** Accepted
**Reference:** Issue #621

**Context:** Pressing Ctrl+C during `arbiter init` produced inconsistent behaviour: inquirer raised `ExitPromptError`, `runWizard` logged `Cancelled.` via the internal `log` helper (invisible in non-TTY), and the process exited 0 (success). Any in-flight `.arbiter-tmp-*` files written before the interrupt were left on disk.

**Decision:**

- `runWizard` catch block in `src/wizard/prompts.ts` now calls `cleanupInFlightTmpFiles()` before returning, then sets `process.exitCode = 130` and prints `\n  Aborted — no changes made.\n` to stdout. This is the single authoritative abort path for `ExitPromptError` and its variants (detected via the existing `isUserCancellation()` helper).
- `cleanupInFlightTmpFiles()` promoted from an internal helper to a public export in `src/utils/fs.ts`. The existing `doCleanup()` internal function is reused; `registerCleanupHandlers()` continues to call it directly for raw SIGTERM/SIGINT (non-TTY path, where inquirer never fires).
- The duplicate `log('\n  Cancelled.\n')` call that was in `src/commands/init.ts` is removed. The normal "No" path (user declines the confirm prompt) prints `\n  Cancelled.\n` via `console.log` directly in `prompts.ts` for consistency.
- Exit code 130 follows the POSIX convention for SIGINT termination (`128 + 2`). `process.exitCode` (not `process.exit(130)`) is used so the async unwind completes before Node exits.
- L4 file lock release (`TODO(#614)`) deferred: a placeholder comment marks the intended call site.

**CANON-16 survey:** `isUserCancellation()` (prompts.ts:172) and `doCleanup()` (fs.ts) existed and were reused. No new source files added.

**Consequences:** `arbiter init` Ctrl+C now exits 130, prints a clear message, and leaves no orphan tmp files regardless of when in the wizard flow the interrupt fires.

## ADR-069: Action pin parity — dependabot bypass fix (#911)

**Date:** 2026-05-19
**Status:** Accepted
**Reference:** Issue #911

**Context:** `dependabot[github-actions]` bumps action version pins in `.github/workflows/*.yml` only. EJS source templates at `src/templates/github/workflows/*.yml.ejs` are the downstream SSOT but are invisible to dependabot. `__tests__/parity/ci-tier-render-parity.test.ts` asserts that committed yml equals `renderTemplate(ejs, fixture)`, so any dependabot action-bump PR fails Unit Tests and Tech Debt Gates (both run vitest) plus CI Required in cascade. All 4 open github-actions PRs (#905–#908) were blocked by this.

**Decision:**

- `scripts/sync-action-pins.mjs` (new, selfOnly): for each `.github/workflows/<x>.yml` ↔ `src/templates/github/workflows/<x>.yml.ejs` pair, extracts `uses: <action>@<version>` pins from the yml and text-substitutes them into the EJS. Modes: write (EJS ← yml, default), `--check` (read-only, exit 1 on drift), `--reverse` (yml ← EJS, for human SSOT-first edits).
- `scripts/check-all.mjs` L1: adds `runCheck('action pin parity', 'node', ['scripts/sync-action-pins.mjs', '--check'])`. Belt-and-suspenders with the vitest parity test; provides faster local signal and catches human-side drift too.
- `.github/workflows/dependabot-actions-sync.yml` (new, arbiter-self-only): triggered on `pull_request` paths `.github/workflows/**` from `dependabot[bot]` with `github_actions/*` head. Runs sync script; commits changed EJS back to the PR branch so parity test passes on the re-triggered run.
- Runbook at `docs/RUNBOOKS/dependabot-handling.md`: protocol for triage, rebase, and the required manual `approved-by-human` label (INV-74 stays — dependabot auto-merge is out of scope).

**CANON-16 survey:** No existing yml↔EJS sync utility found (`scripts/sync-*.mjs` cover changelog and governance copy; unrelated). New file justified. No EJS templates created or edited — workflow file written directly as YAML (arbiter-self-only, not emitted for downstream projects, so CANON-01/CANON-04/CANON-18 do not apply).

**Sync direction rationale:** yml is the ground truth for what runs in CI (dependabot edits it directly). EJS is the derivable artifact for downstream. Sync direction yml → EJS means the EJS always tracks what CI actually runs.

**Consequences:** Dependabot github-actions PRs auto-fix their own EJS divergence on the first CI run after the new workflow merges. Human approval (INV-74) remains required for merge. The L1 gate catches any future human-side drift before commit.

## ADR-070: Toolchain audit generator — W11 evidence bundle (#887)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #887, umbrella #875

**Context:** W11 closes the planning-skeleton migration (W1–W11). The deliverable is a self-validating audit script that proves the toolchain is intact: CI workflow files exist, gate scripts exist, build toolchain is defined. This is Track A (arbiter-self) + Track B (target projects via EJS generator).

**Decision:**

- `scripts/audit-toolchain.mjs` (Track A): arbiter-self version, always passes on the arbiter repo.
- `src/templates/scripts/audit-toolchain.mjs.ejs` (Track B): EJS template emitted to target projects via `arbiter init`/`arbiter update`.
- `src/generators/audit-toolchain.ts`: generator function (CANON-05); always enabled; added to registry.
- `src/config/diff.ts`: `GeneratorKey` union extended with `'audit-toolchain'`.
- Dogfood: `src/templates/scripts/` is NOT in scope for `check-self-dogfood.mjs` (which only covers `src/templates/claude/`), so no dogfood divergence entry is needed.

**CANON-16 survey:** `self-validation.ts` is the closest neighbor (A/B/C drill harness). Distinct responsibility: inventory audit vs. drill harness. No refactor viable. New file justified.

**Consequences:** Target projects generated at any level (L1/L2/L3) receive `audit-toolchain.mjs`. Template tests baseline updated 147→145 (2 fewer untested EJS files).

## ADR-071: F6 — k6 performance testing ecosystem template (#895)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #895

**Context:** F2-java (#889) and W10 (#886) shipped tooling for extended CI tiers including soak and endurance testing categories. A dedicated k6 ecosystem template was needed to cover systematic performance testing across load profiles (load, stress, spike, soak, volume, breakpoint, smoke, ramp-up, ramp-down, steady-state, burst, endurance).

**Decision:**

- `src/generators/perf-k6.ts` (new): generator emitting the full k6 ecosystem, gated on `enablePerfTesting?: boolean` in `ProjectConfig`. All 19 output files use `skipIfExists` for brownfield safety.
- `src/templates/github/workflows/11-k6-on-demand.yml.ejs`: `workflow_dispatch`-triggered dispatcher that delegates to the reusable runner. Slot 11 chosen because slot 10 is occupied by `10-deploy-prod.yml.ejs` (F10, #899).
- `src/templates/github/workflows/_k6-runner.yml.ejs`: reusable workflow (`workflow_call`) that installs k6, validates scenarios, runs them, generates HTML report, and uploads artifacts.
- 12 named scenario templates under `src/templates/perf/k6/scenarios/`: each exports `options` + `export default function` (k6's required entry point) and imports from `k6`.
- 3 Python report generators under `src/templates/perf/k6/reports/`: HTML (with Jinja2-style template), JSON (aggregated summary), CSV (flat tabular).
- `src/templates/perf/k6/seed/test-data.sql.ejs`: PostgreSQL seed SQL using `generate_series` to create realistic test data volumes.
- `src/templates/scripts/validate-k6-scenarios.mjs.ejs`: scenario completeness validator checking for required entry point, k6 import, and `options` export.

**CANON-04:** 54 render tests added in `__tests__/templates/k6-render.test.ts`. **CANON-05:** Generator unit tests in `__tests__/generators/perf-k6.test.ts`. **CANON-11:** Brownfield tests in `__tests__/brownfield/perf-k6-brownfield.test.ts`. **CANON-16 survey:** Grepped `src/generators/` and `src/templates/` for `k6`/`perf` — nothing similar exists; new files justified.

**Consequences:** Projects opting in via `enablePerfTesting: true` get a complete k6 perf ecosystem on `arbiter init`. Existing projects (brownfield re-init) are unaffected due to `skipIfExists`.

## ADR-072: Loud-bypass contract library (Workstream C Port #10, #970)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #970, Workstream C Port #10

**Context:** Multiple upcoming gates (`ARBITER_PREPUSH_BYPASS` in Port #4, `ARBITER_GATE_BYPASS` for `scripts/check-all.mjs`) need a shared, deterministic, and deliberately loud env-var bypass contract. Without a shared library each gate would re-implement the contract slightly differently — a known source of silent-bypass bugs and inconsistent log shapes.

**Decision:**

- `scripts/lib/loud-bypass.mjs` (Level A only): exports `checkBypass(envName, opts)`. Returns `{ bypassed: true, reason, branch, ts }` ONLY when the env value is the **exact string** `'true'`. On any other non-empty value (`'1'`, `'yes'`, `'TRUE'`, `'on'`, ...) emits a loud stderr warning, returns `{ bypassed: false }`, and **never exits non-zero** (RED-TEAM B2 amendment: typo'd env vars must not brick the gate). On unset or `''`, the function is silent.
- `scripts/lib/log-bypass.mjs`: tiny CLI wrapper (`node scripts/lib/log-bypass.mjs <ENV> [reason]`) for use from shell hooks; always exits 0.
- Stderr format (RED-TEAM N6): `arbiter-bypass env=<NAME> branch=<BRANCH> at=<ISO_TS> reason="<REASON>"` — deliberately key=value with the `arbiter-bypass` token, **must not** match any other tooling's `[BYPASS]` bracketed convention.
- JSONL audit log: every non-silent invocation appends one line to `.arbiter/evidence/bypass-log.jsonl` with `{env, branch, ts, value, bypassed, reason}`.

**Legacy contracts NOT migrated:** Existing `ARBITER_SKIP_TDD=1`, `ARBITER_PLAN_BYPASS=1`, `ARBITER_SSOT_BYPASS=1`, and `ARBITER_SKIP_GATE_MARKER=1` consumers retain their numeric-truthy semantics. They are grandfathered to preserve documented user-facing contracts. The new library applies to NEW env vars only.

**Pre-audit grep recorded:**

```
scripts/check-tdd-evidence.mjs:  const envSkip = process.env.ARBITER_SKIP_TDD === '1'
scripts/visual-verify.mjs:const forcePWSkip = process.env.PLAYWRIGHT_SKIP === '1'
src/templates/claude/hooks/enforce-gate-before-pr.mjs:if (process.env.ARBITER_SKIP_GATE_MARKER === '1') {
src/templates/claude/hooks/pre-edit-ssot-guard.mjs:if (process.env.ARBITER_SSOT_BYPASS === '1') process.exit(0)
src/templates/claude/hooks/pre-edit-plan-anchor.mjs.ejs:if (process.env.ARBITER_PLAN_BYPASS === '1') process.exit(0);
```

Identical pre/post audit confirms no legacy migration.

**CANON-16 survey:** Closest existing utility is `scripts/lib/run-helpers.mjs` (gate runner trinity). Distinct responsibility — that one wraps `spawnSync` for gate steps, this one handles env-var bypass contracts for downstream consumers. Refactor not viable. New file justified.

**Tests:** `__tests__/scripts/lib/loud-bypass.test.ts` — 17 cases including table-driven coverage of `'true'`, `'1'`, `'yes'`, `'TRUE'`, `'on'`, `'false'`, `''`, undefined; structured bypass detail; ambiguous detail (exit 0 + warn); silent unset; defensive auto-mkdir; legacy-env non-consumption; CLI wrapper bypass/ambiguous/unset/usage cases. Negative assertion `expect(stderr).not.toMatch(/\[BYPASS\]/)` enforces format divergence.

**Consequences:** Future bypass-gate authors call `checkBypass('ARBITER_FOO_BYPASS')`; shell-side authors call `node scripts/lib/log-bypass.mjs`. Both share the same loud audit trail. First consumer lands in Workstream C Port #4 (pre-push evidence-freshness gate).

---

## Decision: PR-A max-tier workflow patterns (L4 workflow baseline) — Issue #1005

**Date:** 2026-05-22  
**Status:** decided  
**Reference:** Issue #1005 (PR-A)

**Context:** arbiter's EJS workflow templates diverged from the internal reference project, which had solved several real supply-chain and branch-flow problems. The max-tier (L4) templates are the canonical source; lower tiers inherit via EJS guards.

**Decisions:**

1. **Release trigger = tag-only.** `05-release.yml.ejs` trigger is `push: tags: [v*, !v0.0.0-verify-*]` + `pull_request: branches: [main]`. Drop `push: branches: [main]` and `workflow_dispatch`. Rationale: prevents accidental double-release; enforces explicit intent via semver tag.

2. **Sigstore preflight before every cosign operation.** A `curl -sf https://status.sigstore.dev/api/v2/status.json` check runs before `cosign sign` and before `cosign sign-blob`. Emits `::warning::` on degraded status; exits non-zero on `major`/`critical` status to avoid wasted retry storms against a known-down Fulcio/Rekor.

3. **`trivy-strict-release` gate job** (service archetype only). Builds Docker image to tar, scans with `exit-code: 1` on HIGH/CRITICAL BEFORE pushing to registry. Separate job so it runs in parallel with `cosign-sign`/`attest-build-provenance`. Trivy DB is cached per run to minimize network cost.

4. **Post-sign cosign verify** (L3+ / `_slsaL3` guard). After pushing and signing the OCI manifest by digest, `cosign verify --certificate-identity-regexp ... --certificate-oidc-issuer ...` confirms the signature is queryable in the transparency log. Detects ephemeral network failures that left a corrupted entry.

5. **macOS keychain bypass** (gated `if: runner.os == 'macOS'`). Writes `{"credsStore":""}` to `$HOME/.docker/config.json` before `docker/login-action`. Zero cost on Linux; enables self-hosted Mac runners without macOS keychain prompts blocking CI.

6. **`develop` added to PR workflow branch triggers** (`01-pr-fast`, `02-pr-extended`). `cancel-in-progress` now guards both `main` and `develop`: `github.ref != 'refs/heads/main' && github.ref != 'refs/heads/develop'`.

7. **`_sigstore-retry-sign.yml.ejs` OCI re-sign mode.** Added `workflow_dispatch` trigger with `image_ref` + `justification` inputs. `resign-oci-image` job (owner-only guard, sigstore preflight, registry login, `cosign sign --yes $image_ref`, `cosign verify` post-sign, audit log to `$GITHUB_STEP_SUMMARY`). Original `sign-with-retry` job unchanged (blob-retry, `workflow_call` only).

8. **`check-docs.mjs` pre-commit bypass via `ARBITER_SKIP_DOCS=true`.** The `[skip-docs]` commit message bypass works for CI (commits already in `git log`) but cannot work pre-commit (COMMIT_EDITMSG is written by `prepare-commit-msg`, which runs AFTER `pre-commit`). Added `checkBypass('ARBITER_SKIP_DOCS')` from `loud-bypass.mjs` as the pre-commit bypass path. The `[skip-docs]` commit message bypass is retained for CI.

---

## Decision: PR-B deployTarget abstraction (planning-main parity) — Issue #1005

**Date:** 2026-05-22
**Status:** decided
**Reference:** Issue #1005 (PR-B), plan `.claude/plans/floating-nibbling-puppy.md`

**Context:** `04-deploy-test.yml.ejs` and `10-deploy-prod.yml.ejs` contained placeholder TODO steps for the deploy phase. A new `deployTarget` config field dispatches to per-cloud EJS partials, replacing the placeholders with a complete supply-chain-safe deploy pipeline.

**Decisions:**

1. **`deployTarget` config field** (`ghcr | azure-container-app | aws-ecs | gcp-cloud-run | none`). Added to `ProjectConfig` and `WizardAnswers`. Zod schema defaults to `'none'` so older configs without the field do not crash on load (RT-2). Wizard prompt shown only for `backend-web-db` archetype; all other archetypes force `'none'` in `buildConfigFromAnswers` (RT-15).

2. **EJS whitelist preamble before every `include()` call (RT-7).** `const _dt = ({ghcr:'ghcr',...})[typeof deployTarget !== 'undefined' ? deployTarget : 'none'] ?? 'none'` prevents path traversal if `arbiter.json` is hand-edited. `typeof` guard prevents `ReferenceError` in EJS `with(locals)` scope when field absent from legacy data objects.

3. **`cosign copy` for image promotion — not `crane tag` or `docker tag` (RT-8).** OCI referrers (signatures, SBOM attestations) are silently dropped by retag operations. All `_cosign-copy/*.ejs` partials use `cosign copy SRC DST` with a mandatory comment explaining the requirement.

4. **Per-cloud EJS partials use `.ejs` extension (RT-5).** `.ejs.txt` extension bypasses the CANON-04 ratchet (`check-template-tests.mjs` only tracks `.ejs` files). New include-only partials are absorbed via `--update-baseline` as tested-via-parent.

5. **`enableDeployWorkflows` and `enableAzureContainerApp` derived — not prompted.** Both flags are computed in `buildConfigFromAnswers` from `deployTarget`. `enableDeployWorkflows = (deployTarget !== 'none')`. `enableAzureContainerApp = (deployTarget === 'azure-container-app')`. The `enableDeployWorkflows` field is `@deprecated` in JSDoc; the generator gate uses `(config.deployTarget ?? 'none') !== 'none' || config.enableDeployWorkflows` for backward compat.

6. **Sigstore preflight extracted to shared partial.** `_partials/sigstore-preflight.ejs` replaces the inline curl block in `04-deploy-test.yml.ejs` and is added to `10-deploy-prod.yml.ejs`. Two usages satisfy CANON-16 extraction justification.

## Decision: KIT self-canary stays advisory (schedule + issue), not blocking or auto-committed — Issue #1091

**Date:** 2026-05-30
**Status:** decided
**Reference:** Issue #1091, #1065 (closed), PR #1114 (baseline regenerated @ ba4f9530)

**Context:** #1091 flagged the KIT self-canary (`.github/workflows/kit-self-canary.yml`) as red-by-construction (fixed: #1065 closed, baseline regenerated to byte-match), and left two open questions: (#2) should CI auto-commit the regenerated baseline on a clean checkout, and (#3) should the canary be blocking vs advisory.

**Decisions:**

1. **Advisory, not blocking.** The canary stays scheduled (nightly `0 3 * * *`) + `workflow_dispatch`, filing a `kit-drift` issue on divergence. It is NOT folded into `check-all.mjs` L2 nor made a required PR status check. Rationale: it is a drift detector over generated KIT output, not a correctness gate on the change under review; blocking every PR on it couples unrelated drift to all merges and reintroduces the red-by-construction flakiness the issue set out to remove.

2. **No CI auto-commit of the baseline.** CI does NOT `git add/commit/push` the regenerated `docs/REFERENCE/SELF-KIT-AUDIT.md`. Auto-committing to `main` from a workflow bypasses branch protection and human review (INV-74/INV-101). The baseline is regenerated by hand via a normal reviewed PR (`node dist/cli.js kit install --experimental.kit --dry-run --report-path docs/REFERENCE/SELF-KIT-AUDIT.md`), as the drift issue instructs.

3. **Closes #1091.** Item #1 (regen + close #1065) shipped in PR #1114; items #2 and #3 are resolved by this decision (advisory + human-regenerated baseline).
