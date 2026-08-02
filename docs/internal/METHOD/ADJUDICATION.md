---
title: 'Adjudication with Audit — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-02'
owner: ''
canonical_id: 'ADJUDICATION'
tags: ['audience/dev', 'audience/agent', 'kind/method']
related:
  [
    'docs/methodology/agent-orchestration-and-context-hygiene.md',
    'docs/internal/METHOD/EVIDENCE_RETENTION.md',
  ]
---

# Adjudication with Audit — arbiter

## 1. Scope

This protocol applies whenever a MECHANICAL matcher — regex, keyword,
line-number, or heuristic — renders a verdict over LLM-GENERATED TEXT against a
ground-truth manifest.

Canonical shapes are:

- finding → injected defect: did the reviewer catch defect D?
- claim → evidence: does the cited artifact support the claim?
- verdict → rubric: does the verdict satisfy the rubric?

This protocol does NOT apply when both sides are structured and deterministic:
id equality, hash equality, or exit codes are plain comparison and need no audit.
The deterministic gold-audit engine is out of scope: it scores artifacts, not
prose.

## 2. The protocol

Run the rungs in order. Enter each rung only when the previous rung fails.

1. **Rung 1 — mechanical matcher.** Run the mechanical matcher over the full
   set. It is cheap, deterministic, and reproducible.
2. **Rung 2 — pre-registered sampled audit (the gate).** Before looking at any
   matcher output, register the sample size, sampling rule, and pass threshold.
   The default sample size is 20 decisions. Sample stratified across positive
   and negative verdicts and across conditions or arms. A human or independent
   judge re-decides the sampled decisions by hand. Matcher precision below the
   pre-registered threshold FAILS the gate.
3. **Rung 3 — full re-adjudication.** On a failed audit only, independent LLM
   judges re-adjudicate the entire set. Never patch the matcher and re-run the
   same audit sample: a matcher tuned on its own audit sample has no remaining
   out-of-sample evidence.

| Rung | What runs | Pass condition | Cost |
| ---- | --------- | -------------- | ---- |
| 1 | Mechanical matcher over the full set | Matcher emits a reproducible verdict | Cheap |
| 2 | Pre-registered stratified sample, decided independently by hand | Precision meets the registered threshold | Moderate |
| 3 | Independent LLM judges over the entire set | Re-adjudicated verdicts satisfy the adjudication record | Highest |

Pre-registration is what makes rung 2 a gate. A threshold chosen after seeing
the numbers is not a gate.

## 3. Rung-3 requirements

Each requirement below is a MUST. Together they make the judge trustworthy.

1. **Independence.** Use N independent judges. Each judge MUST see only the item under adjudication — no sibling verdicts, matcher verdict, or
   orchestrator opinion.

2. **Blind to condition.** Judges MUST NOT know which experimental arm, model,
   or treatment produced the text. Strip arm labels, run ids, and file paths
   that leak the condition.

3. **Verbatim quote per positive verdict.** Every YES or MATCH verdict MUST
   carry the exact substring from the adjudicated text that justifies it. A
   verdict without a quote is not a verdict. This is the single cheapest
   anti-hallucination control: the quote is mechanically checkable afterwards.

4. **Spot-check QC.** QC MUST follow adjudication. Sample the
   positive verdicts and confirm that each quote occurs in the source text via
   an INDEPENDENT grep. Do not use the judge's own tooling or the same harness
   that produced the verdict. A quote that does not occur verbatim invalidates
   the verdict. A QC failure rate above the pre-registered ceiling invalidates
   the judge run.

## 4. Failure modes

**Co-location misattribution.** Two ground-truth items occupy the same
function, block, or file region. A matcher credits a finding about item A to
item B because both live at the same location. This presents as inflated recall
on dense manifests. Rung 2 or rung 3 catches it; any location-only matcher
cannot.

**Line drift.** The manifest pins line numbers, but edits, formatting, or
context truncation shift the adjudicated text. This presents as false negatives
that look like model failures. Never pin a line number as the sole match key.
Match on semantic content and treat location as corroborating, not deciding.
Rung 2 or rung 3 catches the resulting mismatch.

**Keyword brittleness.** The matcher keys on expected vocabulary, while the
model describes the same defect in different words — or uses the right words
in a wrong-sense sentence. This produces false negatives from paraphrase and
false positives from keywords in negated or unrelated clauses.
Rung 2 or rung 3 catches keyword brittleness; rung 1 cannot distinguish these
cases reliably.

**Judge leniency.** An LLM judge drifts toward crediting near-misses, especially
with a "did the reviewer notice anything about X" framing. Use REFUTE framing:
credit only what you fail to refute. The verbatim-quote requirement and QC
sample counter leniency. The sibling bias documented in the refutation skill
also applies: a single judge inherits its own blind spots; N independent judges
bind it. Rung 3 controls this failure through REFUTE framing, independent
judges, verbatim quotes, and QC.

## 5. Record

Persist enough evidence for the adjudication to be re-checked:

- the pre-registered analysis plan — sample size, sampling rule, and threshold —
  dated and committed BEFORE the audit;
- the matcher output;
- the audit decisions;
- the judge verdicts with quotes;
- the QC sample and its result; and
- an explicit deviations log for anything that departed from the
  pre-registration.

Evidence lives according to `docs/internal/METHOD/EVIDENCE_RETENTION.md`.

## 6. Provenance

Epic #2176, the controlled `/ship` v2 study with 193 runs, audited the mechanical
matcher twice under pre-registration and failed both times at roughly 50–70%
precision. Co-located defects and line drift drove the failures. The study's
results were produced by full re-adjudication with 3 independent judges, blind
to arm, with a verbatim quote required per positive verdict and sampled QC via
independent greps. This document exists because the cheaper path was tried
first and did not hold.
