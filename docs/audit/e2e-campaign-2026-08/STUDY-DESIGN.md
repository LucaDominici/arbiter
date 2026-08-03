---
title: 'Ship v2 study — experimental design — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# Study: Orchestrated-Specialist Planning vs Single-Planner in a Ship Pipeline — v2

**Status:** design v2 — red-team amendments merged (see RED-TEAM findings 1–25; all CRITICAL/HIGH accepted, MEDIUM accepted, LOW accepted)
**Date:** 2026-08-02

v1 was rejected by adversarial review: token confound (P3 plans longer → effect not attributable to orchestration), n=3 statistically inert, RQ2 catch-rate unobservable end-to-end, hidden-test leakage channels, fix-round asymmetry. v2 restructures into two separable experiments plus one observational study.

## Experiment A — Review factor (held-constant defective diff)

**Question (ex-RQ2):** what defect-catch rate and false-positive rate does each review strategy deliver, at what cost?

**Materials:** per task (T1/T2/T3), ONE fixed defective implementation: start from the reference solution, inject 8 known defects (3 logic, 3 security where applicable, 2 edge-case), each recorded in `defects.json` manifest: `{id, file, lineStart, lineEnd, class, description}`. Also ONE clean diff (reference solution unmodified) for false-positive/damage measurement.

**Arms (review stage only, nothing else runs):**

- `R1n` — 1 conformance reviewer, narrow mandate (plan ACs only) — the "cheap review" as originally proposed
- `R1b` — 1 reviewer, broad mandate (conformance AND hunt logic/security/edge defects) — same agent count, full mandate
- `R2` — 2 reviewers (bugs+logic, security+edge), broad
- `R3` — 3 reviewers (bugs, security, edge), broad — models current /ship panel

R1b vs R1n isolates MANDATE; R1b vs R2 vs R3 isolates AGENT COUNT at constant mandate. All reviewers receive: ISSUE.md, plan (a fixed P1-style plan, same file for all arms of a task), diff, source. Findings schema identical everywhere; shared severity rubric with anchors.

**Runs:** 4 arms × 3 tasks × (8 reps defective + 4 reps clean) = 144 review-stage runs (cheap: 1–3 short calls each).

**Outcomes:** per-defect detection (mechanical adjudication: finding references the defect's file AND overlaps [lineStart−5, lineEnd+5] OR names the defect behavior per manifest keywords; a manual audit of 20 random matches/non-matches validates the matcher); false positives = findings on clean diff + findings on defective diff matching no defect; cost + api-duration per arm.

## Experiment B — Planning factor (end-to-end, review held constant)

**Question (ex-RQ1):** does multi-specialist planning beat a single planner — and is any gain attributable to orchestration rather than plan length/content?

**Arms (plan stage varies; everything downstream IDENTICAL):**

- `B0` — no plan
- `B1` — single planner, standard prompt (current /ship shape)
- `B1L` — single planner, EQUAL-CONTENT control: prompt enumerates the exact union of sections the three specialists + merge produce (approach, decomposition/boundaries, threat model, abuse cases, input-validation reqs, idiomatic patterns, pitfalls, recommended stdlib APIs, merged ACs, test strategy, risks), instructs draft-then-revise-once, with a target length calibrated to the pilot's median P3 plan length
- `B3` — 3 specialists (architect, security, best-practice) + merge

Downstream for ALL arms including B0: implement (identical prompt; plan clause: "Follow the plan. Where the plan conflicts with ISSUE.md acceptance criteria, ISSUE.md wins.") → UNCONDITIONAL self-verify-and-fix stage (identical prompt: "re-verify the implementation against ISSUE.md acceptance criteria; findings may be empty; fix what you find"). Total code-touching turn budget constant across arms (implement 50 + fix 30).

**Runs:** pilot/power phase first — 10 reps of B0 on T2 to estimate within-cell SD and check the difficulty band (V0 mean hidden-pass must land in 0.3–0.7, else re-tune tasks). Then 4 arms × 3 tasks × 5 reps = 60 runs (rep count revisited after SD estimate; if MDE is hopeless at 5, collapse to primary contrast B3 vs B1L only with more reps).

**Outcomes:** primary = behavior-only, defect-class-clustered hidden-test pass rate (implementation-marker tests reported separately, never in primary). Secondary: visible pass, cost, api-duration, plan token count (covariate — pre-registered: any B3 advantage must survive conditioning on plan length), outcome classification (assertion-fail / import-error / crash / timeout — non-assertion outcomes flagged, never silently scored 0), test-tamper rate, abort rate (intention-to-treat: aborted runs evaluated as-is).

## Study C — Complexity detector (observational, real data)

**Question (ex-RQ4):** can a haiku-class classifier triage issue complexity? Measured on ~40 REAL closed arbiter issues with merged PRs: classifier sees issue text only; ground truth = actual merged-diff size (mapping pre-registered in ANALYSIS-PLAN.md: XS ≤2 files & ≤50 LOC; S ≤5 files & ≤200 LOC; M ≤15 files & ≤800 LOC; L above). Report confusion matrix + adjacent-accuracy. Zero pipeline runs.

## Benchmark tasks

As v1 (T1 parseDuration bugfix / T2 rate limiter / T3 static files + token auth), with amendments:

- ISSUE.md ACs freeze the public entry point (exact module path + exported signature) — internal restructuring legal, seam fixed.
- Hidden tests partitioned behavior-only vs implementation-marker; `timingSafeEqual` source-regex is a marker, not primary. Defect classes defined per task in `classes.json`; primary metric clusters by class.
- Canary token per hidden-test file; any canary appearing in a stage transcript, diff, or sandbox tree fails the run (first-class metric).
- Hidden tests deterministic (injectable clock), per-test timeouts, no suite-level collapse.

## Validity measures (from red-team)

Sandbox materialized via mktemp OUTSIDE the study tree (no path to `tasks/` or `results/`; runner asserts no ancestor `CLAUDE.md`/`.claude/`). `.study/` artifacts host-side, excluded from diffs; runner asserts diff touches only `src/`. Detector output never enters the sandbox. Bash allowlist restricted to the exact `node --test test/` invocation. Runner asserts no `test/` or `package.json` modification (violations reverted + recorded as tamper metric). Pre-stage git checkpoints; retries restart from checkpoint; billed vs effective cost both recorded. Seeded (LCG, logged) variant-balanced block ordering; concurrency 2; time metric = `duration_api_ms`; retried stages excluded from duration; latency claims only from a serial concurrency-1 subset. Fully-dated model IDs pinned per stage, resolved model asserted unique per role at analysis.

## Analysis & reporting

Pre-registered in ANALYSIS-PLAN.md (committed before first paid run): primary contrasts, effect-size-with-bootstrap-CI framing (NO p<0.05 claims from Exp B; Exp A has real power), plan-length conditioning, ROI reported as cost-quality frontier with dominance statements only (never point-estimate ROI rankings), decision rule mapping outcomes → /ship recommendation INCLUDING the no-change outcome, and signed direction-of-bias statements for every external-validity threat (sandbox has no gates → overstates reviewer value; small tasks → understates planning value; one-shot implementer → overstates plan value).

Judge (secondary, cannot overturn hidden tests): scores diffs against ISSUE.md ACs only (identical across arms), diff-only (never sees plans), 3× per diff, ICC reported, metric dropped if ICC < 0.5.

## Deliverables

1. Scientific report (Artifact): literature review + Exp A + Exp B + Study C + frontier analysis + signed threats + /ship v2 recommendation (which may be "no change").
2. Raw JSONL + analysis scripts, reproducible.
3. GitHub issue with the evidence-linked proposal.
