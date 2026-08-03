---
title: 'Ship v2 study C — complexity detector results — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# Study C Results — text-only complexity detector on real arbiter issues

Frozen protocol: ANALYSIS-PLAN.md §Study C. N=45 real closed arbiter issues with merged PRs (ground truth = merged diff size excluding generated paths `.arbiter/`, `docs/wiki/`, lockfiles, golden fixtures, real-project fixtures, `graphify-out/`). Classifier: `claude-haiku-4-5-20251001`, issue title+body only, no tools, 1 turn. Total cost $0.55, 0 parse errors.

## Result: FAILS the pre-registered viability bar

| Metric                                   | Value      | Bar           |
| ---------------------------------------- | ---------- | ------------- |
| Exact accuracy                           | 26.7%      | —             |
| Adjacent accuracy (off-by-one)           | 75.6%      | ≥90% required |
| Fail-dangerous (true L → predicted XS/S) | 9/45 (20%) | 0 required    |

Confusion (rows = truth from merged diff, cols = predicted):

|        | XS  | S   | M   | L   |
| ------ | --- | --- | --- | --- |
| **XS** | 3   | 0   | 0   | 1   |
| **S**  | 1   | 3   | 0   | 1   |
| **M**  | 0   | 9   | 1   | 1   |
| **L**  | 0   | 9   | 11  | 5   |

## Interpretation

Systematic UNDER-estimation: 20/25 true-L issues predicted S or M. On this repo, issue text alone does not carry the information needed to predict diff size — arbiter issues read small but their merged diffs multiply through tests, docs, invariants, and cross-cutting governance surface. A /ship router keyed on a text-only cheap classifier would routinely send heavy issues down the light pipeline — the exact failure the routing literature flags as disqualifying (routing viability requires the cheap signal to discriminate tier; Triage arXiv:2604.07494's effect-size condition).

Consistent with literature: SWE-smith needed a fine-tuned 32B classifier on 1,699 annotated instances to reach 75.3% with only-adjacent errors; zero-shot haiku matches the 75% adjacent number but NOT the "never confuses easy with hard" property, which is the one that matters for routing safety.

## Implication for /ship v2 (to carry into final report)

Text-only LLM triage: NOT viable as the routing signal. The router must use repo-native deterministic signals — arbiter already computes them: `/impact` blast radius (dependency graph), historical nearest-neighbor issue→diff size, labels/milestone (wave/epic ⇒ L), plus the existing auto-tier from diff size at plan time. LLM opinion can be at most a tie-breaker. (Exploratory follow-up, NOT pre-registered: enriching the prompt with labels + linked-file blast radius may fix under-estimation — untested here.)
