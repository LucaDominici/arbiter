---
name: refutation
description: Adversarial refutation-by-majority protocol (M13). Dispatch N independent read-only skeptics with an explicit REFUTE mandate per high-stakes finding; a finding survives only with a strict UPHELD majority. Persist skeptic verdicts as E1 agent-return envelopes and write the refutation-required marker so scripts/check-refutation-verdicts.mjs can adjudicate.
title: 'Refutation-by-majority'
doc_version: '1.0.0'
status: active
last_review: '2026-07-14'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/skill']
related:
  [
    'docs/methodology/agent-orchestration-and-context-hygiene.md',
    'scripts/check-refutation-verdicts.mjs',
    'scripts/check-agent-return.mjs',
  ]
---

# Refutation-by-majority (M13)

High-stakes findings (audit findings at or above a severity threshold, structural claims destined to be acted on) are **not accepted from a single agent**. Independent skeptical agents are dispatched with the explicit mandate to **REFUTE** the finding against the actual code; a finding survives only if it withstands a strict majority.

## Why

Single-reviewer verdicts inherit the reviewer's blind spots and a "reviewing to approve" bias. Refutation-framing plus independence is the cheapest known de-biaser; majority survival bounds both false positives (R4 — the "hexagonal architecture is fiction" incident was the fiction) and rubber stamps (R2).

## Dispatch protocol

1. **Threshold.** Default severity threshold is `high` (`critical` + `high`). Lower only for audit modes that explicitly demand it.
2. **N is declared, not improvised.** Read N from `.claude/agent-dispatch-matrix.json` `refutation_skeptics` for the active tier:

   | tier     | N   |
   | -------- | --- |
   | XS       | 1   |
   | S        | 1   |
   | Standard | 3   |

   Solo XS/S = 1 skeptic (the red-team IS the skeptic). Standard = 3. Gated-review raises the floor to the full vertical set (matrix `tier_verticals.Standard`).

3. **Independence.** Spawn N read-only skeptics (registry ladder per `.claude/AGENT_REGISTRY.md`; rule-50 read-only clause makes them legal in parallel without worktrees). Each skeptic receives:
   - **only** the finding text + its citations — no sibling verdicts, no orchestrator opinion;
   - the mandate: "your job is to REFUTE this claim against the actual code; return UPHELD only if you fail to refute it."
4. **Persist.** Each skeptic's return is an E1 agent-return envelope (`role:"skeptic"` + `refutations[]`), piped through `node scripts/record-agent-return.mjs --task '#NNN'`.
5. **Marker.** The **orchestrator** writes `.arbiter/evidence/agent-returns/<task>/refutation-required.json` at dispatch time — before the skeptic verdicts come back, as a numbered step of the review phase. The gate below adjudicates only when the marker exists, so leaving it to post-hoc discretion turns the gate into one that never fires. When the review produced no findings at or above the threshold, still write the marker with an empty `findings` array: that records the threshold was evaluated, instead of leaving "no marker" ambiguous between "nothing to refute" and "step skipped".

   ```json
   { "task": "#NNN", "threshold": "high", "skeptics": 3, "findings": ["f1", "f2"] }
   ```

   `findings` = the ids requiring refutation (the acted-on set). The skill refuses to conclude while `scripts/check-refutation-verdicts.mjs` is non-zero.

## Majority rule

`UPHELD > N/2` ⇒ the finding survives and may be acted on. Otherwise it is **demoted to `info` and logged** — never silently dropped (M14 discipline: a refuted finding is still a recorded finding, just not an actionable one).

## The loop: hop until nothing above `low` survives (INV-145, CANON-24)

One pass is not the protocol. After the skeptics report and their findings are **fixed**, dispatch a **fresh** round against the fixed tree — the new hop attacks the fixes, not the original claims — and repeat until no finding above `low` remains unaddressed. Empirically (#2480) the second hop destroyed the first hop's fixes twice: a gate that passed round 1 was still scoring a fully commented-out document 12/12.

Each hop is independent by construction: new agents, disjoint scopes, prompts naming the ARTIFACT and never the previous round's reasoning. Reusing a skeptic, or handing one the last round's rationale, converts refutation into confirmation.

**Prefer the cross-model seat.** When `crossModelReview` is configured (`arbiter.json`, provider e.g. `codex`), the hop runs there: a different model is a materially stronger skeptic than the same model in a different costume, because the blind spots are not correlated. The same-model fan-out below is a **fallback**, and it is weaker in exactly that way.

**A hop that cannot run is recorded, not skipped.** Model unavailable, rate limit, cross-model seat offline: self-probe the round's questions and write `"degraded": true` on the marker. The gate accepts it and says DEGRADED on every run. Never file a self-probe as an independent round.

## Gate

`scripts/check-refutation-verdicts.mjs` (advisory `runWarnCheck` at L2+, promoted to `runCheck` at gated-review) adjudicates **two axes over the same envelopes**:

1. **Majority** — every finding in `findings` must have ≥ N skeptic verdicts and a strict UPHELD majority. Stops a phantom being acted on.
2. **Severity floor (INV-145)** — every finding the skeptics majority-UPHELD at `critical`/`high`/`med` must appear in `findings`. Stops the loop ending while something real is open. Severity is the **highest** any skeptic assigned. Below quorum or majority-REFUTED never blocks: one false alarm must not hold a wave hostage.

Marker present ⇒ both axes run, including when `findings` is empty — a round that addressed nothing while a high finding stood is precisely what the floor catches. No marker ⇒ the gate passes vacuously — which is exactly why step 5 makes writing the marker (empty `findings` included) the orchestrator's unconditional duty at dispatch: the gate can only adjudicate what was declared, and `/ship` and `/drain` both name this step in their review phases.

When a mechanical matcher — rather than this gate's structural check — has to decide whether LLM-authored text matches a ground-truth item, the sampled-audit-then-judge protocol in `docs/internal/METHOD/ADJUDICATION.md` applies.

## Tier right-sizing

Fan-out never exceeds `min(--max-parallel, nproc-2)` (wave-drain cap). Solo never pays N=3 for a typo fix — N=1 is the red-team. Standard pays 3; gated-review pays the full vertical set. N is a declaration in the dispatch SSOT, not a runtime guess.
