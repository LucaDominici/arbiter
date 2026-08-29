---
title: 'ADEQUACY-MAP — arbiter vs the field, docs vs code, and the adjustment plan'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product', 'kind/governance']
related:
  [
    'PRODUCT/FEATURE_MATRIX.md',
    'PRODUCT/GAP.md',
    'PRODUCT/STATUS.md',
    'SYSTEM/CANON.md',
    'INDEX.md',
  ]
---

# ADEQUACY-MAP — arbiter vs the field, docs vs code, and the adjustment plan

> Hand-maintained. Produced 2026-08-29 from (a) an external benchmark of spec-driven / agentic
> development frameworks and (b) three read-only audits of every doc tree against the code at
> `4e16be07`. Each gap below is tracked by a GitHub issue inside one of four dated milestones.
> Refresh whenever a milestone closes; the numbers in §2 are the ones to beat.

## 1. External benchmark — where arbiter stands

Frameworks compared: GitHub Spec Kit, BMAD-METHOD, OpenSpec, AWS Kiro, GSD, Superpowers,
gstack, Hermes, Augment, Tessl, and the Agentsway methodology (arXiv 2510.23664).

| Dimension                               | Field best-in-class                                                              | arbiter today                                                                                                           | Verdict                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Spec artifact per change                | Spec Kit `spec/plan/tasks`; Kiro `requirements.md` with EARS acceptance criteria | Issue body `AC-N:` anchor frozen into the plan; no spec artifact, no requirements rubric                                | **GAP** — #2359, #2364, #2363                                                                                  |
| Constitution / project rules            | Spec Kit constitution; Cursor rules                                              | `AGENTS.md` + INV catalog + CANON — richer and machine-enforced                                                         | **AHEAD**                                                                                                      |
| Phases with checkpoints                 | Spec Kit 4 phases; BMAD 6 personas                                               | `/ship` 8 phases with engine-enforced gates and evidence per phase                                                      | **AHEAD** (but ceremony cost; see train default, ADR-116)                                                      |
| Gates / validation                      | "Constitution enforcement" (documented), QA persona (BMAD)                       | 127 hard checks at L1, 152 at L2, fail-closed audit, TDD evidence re-executed at the RED commit                         | **AHEAD** — unique in the field                                                                                |
| Multi-agent orchestration + audit trail | BMAD file-based handoffs; Hermes parallel + HITL checkpoints                     | Parallel worktree agents, dispatch sidecar + return envelopes, `needs-human` label                                      | **PARITY**; audit trail is stronger, HITL checkpoints weaker (no explicit approval gate outside `needs-human`) |
| Brownfield adoption                     | OpenSpec delta markers (ADDED/MODIFIED/REMOVED)                                  | `arbiter update`/`diff`, adopt-plan, per-file opt-out missing                                                           | **GAP** — #2353, #2305, #2318                                                                                  |
| Spec ↔ implementation drift             | Nobody auto-reconciles ("specs become fiction"); Augment Intent in beta          | `check-acceptance` re-verifies AC-fit at verification; plan↔spec link unverified                                        | **OPPORTUNITY** — #2365, #2366 make this a differentiator                                                      |
| Traceability (RTM)                      | BMAD "audit trail out of the box"                                                | FEATURE_MATRIX RTM + GAP register, both gated — but generators emit corrupt paths and a false "all milestones complete" | **PARITY on paper, broken in practice** — M-A                                                                  |
| Testing discipline                      | Acceptance criteria in specs; QA agent                                           | TDD RED evidence, mutation, contract, BDD, bake E2E, conformance dimensions (10)                                        | **AHEAD**                                                                                                      |
| Metrics                                 | Agentsway completion/quality metrics; no CLI ships them                          | `scripts/ship-kpi.mjs` (new): lead time, review-loop %, evidence-only %, hook blocks                                    | **PARITY**, needs a dashboard and a nightly data point                                                         |
| Portability across agents               | Spec Kit 30+ agents; Superpowers 6 harnesses; Agent Skills open standard         | Claude + Codex (Codex bridge only fixed on 2026-08-29); Cursor rejected at init; skills are Agent-Skills-shaped already | **GAP** — decide the second-tier harness list (M-D)                                                            |
| Memory / lessons across sessions        | Hermes persistent memory; Superpowers session patterns                           | Findings spool, memory hooks, handover convention                                                                       | **PARITY**                                                                                                     |
| Time-to-value / ceremony                | GSD & Superpowers: minutes, lightweight                                          | Expert-only; per-issue ceremony was the default until ADR-116                                                           | **GAP closing** — train default + review cap landed; measure with ship-kpi                                     |

Net: arbiter is ahead on enforcement, evidence and testing; behind on the spec artifact,
brownfield deltas, harness portability and first-use simplicity; and it has one open lane no
competitor owns — mechanical spec↔code drift reconciliation.

## 2. Docs vs code — what the audits found (baseline numbers)

| Tree                                                         | Rows audited | FALSE/STALE | Root cause                                                                                                                                                         |
| ------------------------------------------------------------ | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRODUCT / METHOD / DEVELOPMENT / README                      | ~110         | 41          | `docs/internal/**` is skipped by BOTH `check-doc-links.mjs:46` and `check-doc-style.mjs:43`; `gen-status.mjs` and `gen-gap.mjs` emit defects                       |
| AGENTS.md / SYSTEM / ADR / architecture / runbooks           | ~50          | 13          | universal language ("every", "all 8") over baselined or lowered mechanisms; ADR-023 reversed without supersession                                                  |
| commands / skills / registry / website / llms.txt / examples | ~40          | 14          | phantom-command scan is backtick-anchored (`check-phantom-command-scan.mjs:126`) and blind to fenced blocks; emitted playbooks never re-checked in a consumer tree |

Ten load-bearing defects (full tables in the milestone issues):

1. `docs/internal/**` exempt from link and style gates — the SSOT backbone is unlinted.
2. `arbiter plugin add` documented on the public website and an example README; it does not exist.
3. Emitted `wave-drain` skill calls three scripts consumers never receive; emitted `configure` skill uses `bun run arbiter`.
4. `STATUS.md` reports "all milestones complete" while 3 epics + 19 issues are open (parser only reads `## M<n>`).
5. `GAP.md` corrupts every `__tests__` path and its "Enforcement Gaps" table is token noise.
6. `TESTING.md` lists seven action SHAs that are all wrong, and the wrong workflow file for `bake-e2e-native`.
7. INV-73 says 8 workflows, enforces 6, documents a `migrationStatus` field that does not exist.
8. INV-30 enforcement string claims pitest in `check-all.mjs` L2; ADR-030 removed it.
9. ADR `enforces:` frontmatter covers 3 of 116 ADRs; the ADR-enforcement gate is 2.6% real.
10. INV-96 "every gate script fails closed" sits on a 194-file grandfathered baseline that includes `check-all.mjs` itself; the bypass-ceremony detector is itself advisory.

## 3. Adjustment plan — four milestones

| Milestone                     | Due        | Theme                                                                                                                                           | Exit criterion                                                                                                                                                              |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M-A Truth: docs = code**    | 2026-09-12 | Make the doc gates cover everything, fix the generators, correct every FALSE/STALE row                                                          | `check-doc-links`/`check-doc-style` run on `docs/internal/**`; phantom scan reads fenced blocks; `gen-status`/`gen-gap` emit correct output; zero FALSE rows on re-audit    |
| **M-B Consumer parity**       | 2026-09-26 | Whatever arbiter emits works on first use in a generated project                                                                                | new gate resolves every script/command cited inside emitted markdown against the emitted tree; `plugin add` shipped or deleted; self-only surfaces declared in one manifest |
| **M-C Enforcement integrity** | 2026-10-10 | Claims use precise language and the meta-gates police themselves                                                                                | fail-closed baseline dated and ratcheting; `enforces:` mandatory for active ADRs; bypass-ceremony hard; INV-73 `minPresent: 8`; REUSE_REGISTRY path-checked                 |
| **M-D Spec-driven parity**    | 2026-10-31 | Close the benchmark gaps: spec artifact, requirements rubric, clarification loop, spec↔plan check, brownfield deltas, harness list, KPI nightly | #2359 → #2365 → #2366 landed; ship-kpi runs nightly and its trend is in STATUS.md                                                                                           |

Existing milestones `v0.6`, `v0.7`, `Post-1.0`, `Icebox` stay; their open issues are re-homed
into M-A..M-D (triage table in the tracking issue for this document).

### 3.1 Issue map (created 2026-08-29)

| Milestone                                  | New issues from this audit                                                                                                                                                                                  | Re-homed pre-existing issues                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-A Truth: docs = code (due 2026-09-11)    | #2408 doc gates cover `docs/internal` + fenced phantom scan · #2409 gen-status · #2410 gen-gap · #2411 stale paths/counts batch · #2412 SYSTEM/ADR corrections · #2413 FEATURE_MATRIX rows · #2414 tracking | #2397 nightly regression · #2370 gate timeouts (PR #2396)                                                                                                           |
| M-B Consumer parity (due 2026-09-25)       | #2415 emitted-markdown resolver gate + wave-drain/configure fixes · #2416 `plugin add` decision · #2417 self-only manifest                                                                                  | #2367 experimental generators · #2353 update opt-out · #2318 consumer gitignore guard · #2310 java check names · #2305 adopt-plan preview · #2291 go+ts registry    |
| M-C Enforcement integrity (due 2026-10-09) | #2418 INV-96 baseline · #2419 meta-gates (ADR `enforces:`, bypass-ceremony, INV-73) · #2420 registries/drills                                                                                               | #2384 constraint-map · #2301 gate-blindness rule · #2150 landing mode-aware · #2405 canon-01 re-staged                                                              |
| M-D Spec-driven parity (due 2026-10-30)    | #2421 harness portability · #2422 KPI nightly · #2423 brownfield delta contract                                                                                                                             | #2368 epic · #2359 spec artifact · #2363 clarification loop · #2364 requirements rubric · #2365 spec↔plan check · #2366 convergence · #2039 doctor methodology view |

Order inside a milestone: P0 first (#2408, #2415), then generators (#2409, #2410), then the
batches — the gates must be live before the batches land so the re-audit is mechanical.

## 4. Rules that come out of this

- A doc tree that the doc gates skip is a doc tree that will drift — no more `SKIP_PATH_SEGMENTS` for first-party docs.
- A generated doc is only as true as its generator's tests: `gen-*.mjs` get fixture tests that diff their output against a golden.
- Claims with "every/all" must name the baseline or floor they actually enforce.
- An emitted playbook is verified in the emitted tree, not in arbiter's.
- Every benchmark gap gets an issue with a milestone; the benchmark table is re-scored when the milestone closes.
