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
5. **Marker.** After dispatch, write `.arbiter/evidence/agent-returns/<task>/refutation-required.json`:

   ```json
   { "task": "#NNN", "threshold": "high", "skeptics": 3, "findings": ["f1", "f2"] }
   ```

   `findings` = the ids requiring refutation (the acted-on set). The skill refuses to conclude while `scripts/check-refutation-verdicts.mjs` is non-zero.

## Majority rule

`UPHELD > N/2` ⇒ the finding survives and may be acted on. Otherwise it is **demoted to `info` and logged** — never silently dropped (M14 discipline: a refuted finding is still a recorded finding, just not an actionable one).

## Gate

`scripts/check-refutation-verdicts.mjs` (advisory `runWarnCheck` at L2+, promoted to `runCheck` at gated-review): marker present ⇒ every finding in `findings` must have ≥ N skeptic verdicts AND a strict UPHELD majority. No marker ⇒ nothing to adjudicate (PASS — the scope condition is itself checked, not a skip).

When a mechanical matcher — rather than this gate's structural check — has to decide whether LLM-authored text matches a ground-truth item, the sampled-audit-then-judge protocol in `docs/internal/METHOD/ADJUDICATION.md` applies.

## Tier right-sizing

Fan-out never exceeds `min(--max-parallel, nproc-2)` (wave-drain cap). Solo never pays N=3 for a typo fix — N=1 is the red-team. Standard pays 3; gated-review pays the full vertical set. N is a declaration in the dispatch SSOT, not a runtime guess.
