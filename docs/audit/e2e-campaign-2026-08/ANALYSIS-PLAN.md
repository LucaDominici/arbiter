---
title: 'Ship v2 study — pre-registered analysis plan — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# Pre-registered Analysis Plan — committed before any paid experimental run

Date frozen: 2026-08-02. Any deviation must be reported as a deviation in the final report.

## Experiment A (review factor)

- **Primary outcome:** per-defect detection rate (defect caught = ≥1 finding matching per the mechanical rule: same file AND line overlap within ±5 OR manifest-keyword match; matcher validated by manual audit of 20 sampled decisions — if matcher precision <90% on the audit, all adjudication is redone manually).
- **Primary contrast 1 (mandate):** R1b vs R1n catch rate.
- **Primary contrast 2 (count):** R3 vs R1b catch rate.
- **Secondary:** false-positive count per run (clean-diff findings + unmatched defective-diff findings), cost per caught defect, per-class (logic/security/edge) breakdown, severity-inflation (severity distribution per arm).
- **Statistics:** defect-level binomial outcomes, bootstrap CIs clustered by (task × rep); n=8 reps × 3 tasks × 8 defects = 192 defect-observations per arm → adequately powered for ±10pp differences.
- **Decision rule:** R1b is declared a viable replacement for R3 iff (a) its catch-rate CI lower bound is within 10pp of R3's point estimate AND (b) its false-positive rate does not exceed R3's by more than 2×. R1n is evaluated identically. Otherwise: no change to review recommended.

## Experiment B (planning factor)

- **Primary outcome:** behavior-only, defect-class-clustered hidden-test pass rate (class passes iff all its behavior tests pass). Implementation-marker tests: secondary only.
- **Primary contrast:** B3 vs B1L (orchestration vs equal-content single planner). Secondary contrasts: B1 vs B0 (does planning help at all), B1L vs B1 (does plan richness help), B3 vs B1 (the naive comparison — reported only alongside B3 vs B1L).
- **Covariate rule (pre-registered):** any B3 advantage must survive conditioning on plan token count (logistic regression of class-pass on arm + plan-tokens + task fixed effects, clustered bootstrap by run). If the arm effect vanishes when plan tokens are conditioned, the finding is "plan content, not orchestration".
- **Statistics:** effect sizes with 95% clustered-bootstrap CIs (cluster = run; task as fixed effect). NO significance claims at n=5/cell; language restricted to estimation ("B3 − B1L = +X pp [CI]").
- **Intention-to-treat:** aborted runs evaluated as-is; abort/tamper/canary/non-assertion rates reported per cell; a cell with >10% aborts is void.
- **Pilot gate:** B0 on T2 mean hidden-pass must be in [0.3, 0.7] (else re-tune task difficulty before matrix); within-cell SD from 10 pilot reps decides final rep count (if MDE at 5 reps > 25pp, collapse matrix to B3 vs B1L at 8+ reps).
- **Decision rule:** multi-specialist planning is recommended for /ship iff B3 beats B1L with CI excluding 0 AND the effect survives the plan-token conditioning AND the marginal cost is < 3× B1. If B1L ≈ B3, recommendation is "single planner with enriched multi-perspective prompt" (cheaper, same effect). If B1 ≈ B0, recommendation notes planning showed no measurable value at this task scale (signed: small tasks understate planning value).

## Study C (detector)

- Mapping (frozen): XS ≤2 files & ≤50 changed LOC; S ≤5 & ≤200; M ≤15 & ≤800; L above. Sample: ~40 most recent closed arbiter issues with a merged PR, excluding docs-only. Metrics: exact accuracy, adjacent accuracy (off-by-one bucket), confusion matrix. Decision rule: detector is viable for routing iff adjacent accuracy ≥ 90% AND no L-issue classified XS/S (fail-dangerous confusion = disqualifying).

## Cost/ROI reporting

Cost = billed (including retries); effective also reported. ROI never reported as point-estimate rankings; cost-quality frontier scatter with CIs and dominance statements only. Time = duration_api_ms; wall-clock reported with contamination caveat; latency claims only from the serial subset.

## Multiplicity & framing

Exp A: 2 primary contrasts, Holm-corrected. Exp B: estimation-only, no corrected testing claimed. All other numbers descriptive. The report must include the pre-registered possibility that the correct /ship change is NONE.
