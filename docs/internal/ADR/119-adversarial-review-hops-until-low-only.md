---
title: 'ADR-119: Adversarial review hops until nothing above low survives'
doc_version: '1.0.0'
status: active
last_review: '2026-09-03'
owner: ''
canonical_id: '119'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/SYSTEM/CANON.md',
    'docs/internal/ADR/118-lifecycle-ontology-wired-not-written.md',
    '.claude/skills/refutation/SKILL.md',
  ]
enforces: [INV-145]
---

# ADR-119 — Adversarial review hops until nothing above `low` survives

## Context

`scripts/check-refutation-verdicts.mjs` (E2 #1943, M13) already refused to let a finding be acted
on without a strict UPHELD majority from N independent skeptics. That is one half of the problem.
It says nothing about **stopping**: a review could end with a real, majority-confirmed `high`
finding open, and every gate stayed green.

#2480 made the cost concrete. A gate that read as finished, with 29 passing tests, was refuted
twice in succession:

- Round 1: its engine was absent from `package.json` `files[]`, so an installed arbiter resolved a
  path that did not exist and reported `MODULE_NOT_FOUND` as a document violation — a verbatim
  repeat of #2335, walking straight through the guard written to prevent exactly it, because that
  guard was a hand-maintained list of literal paths. Its skeletons also resolved from
  `src/templates/`, which exists only in a dev checkout, so a real consumer got a permanent silent
  SKIP.
- Round 2, attacking round 1's fixes: a document wrapped entirely in an HTML comment — rendering
  as a single heading — scored 12 out of 12.

Neither was visible to the tests shipped alongside. One pass finds what one reader thought to look
for.

## Decision

**The loop, not the pass, is the unit.** Review repeats — each hop attacking the previous hop's
fixes — until no finding above `low` is left unaddressed. This is wired as a second axis on the
existing gate rather than a new one (CANON-16): both axes read the same skeptic envelopes, so the
loop needs no new artifact.

- Marker-gated, exactly as the majority axis is. No marker ⇒ vacuous pass; the obligation to write
  the marker at dispatch is unchanged and remains the orchestrator's.
- Severity is the **highest** any skeptic assigned. When two disagree, the loop clears the worse
  reading; taking the kinder one would let a second opinion lower the bar.
- A finding **below quorum or majority-REFUTED never blocks.** Reintroducing the false-positive
  failure (R4) in the act of fixing the false-negative one would be a poor trade: one skeptic's
  false alarm must not hold a wave hostage forever.
- The floor runs **even when nothing was acted on**. An early return there made it unreachable for
  the exact case it exists to catch; that bug was found by this ADR's own tests, not by review.

## The fallback is weaker, and says so

The strongest available skeptic is a **different model** — `crossModelReview` with the `codex`
provider — because its blind spots are not correlated with the author's. That seat needs the
owner's local machine and is often unavailable.

The substitute is N fresh same-model agents on disjoint scopes, prompted against the artifact and
never against the author's reasoning. It works: it produced 30 findings across three rounds in
#2480, including two that would have shipped a gate enforcing nothing. But it is **not parity**,
and this ADR declines to claim it is. Same model, same training, same likely blind spots; what the
fan-out buys is independence of _attention_, not of _cognition_.

When no independent skeptic can be reached at all, the round is self-probed and the marker carries
`"degraded": true`. The gate accepts it and prints DEGRADED on every run. A self-review filed as an
independent one is the fake-green this whole catalog exists to prevent, so the evidence records
what actually happened rather than what was wanted.

## Consequences

- A wave cannot close on a confirmed `high`/`med`/`critical`. It must be fixed, or re-graded down
  with evidence, and the next hop must confirm it gone.
- Hops cost time and tokens; the tier ladder (`refutation_skeptics` per tier) keeps a typo fix from
  paying an enterprise price.
- The obligation is now mechanical rather than remembered, which is the point: the invariant was
  stated by the owner after watching two rounds destroy two versions of one gate, and a rule that
  depends on remembering it would fail exactly when fatigue makes it matter most.

## Enforcement

`scripts/check-refutation-verdicts.mjs`, wired on both tracks as `refutation majority (E2 #1943)`.
Verified by `__tests__/scripts/check-refutation-verdicts.test.ts` (15 cases), tamper-proven in both
directions. CANON-24, INV-145.
