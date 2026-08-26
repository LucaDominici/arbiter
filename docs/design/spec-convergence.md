---
title: 'Spec Convergence — re-evaluating the codebase against the spec'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/gen-gap.mjs', 'docs/internal/PRODUCT/FEATURE_MATRIX.md']
---

# Spec Convergence — re-evaluating the codebase against the spec

Re-evaluating the codebase against the spec and queueing what is left — arbiter has the engine, pointed elsewhere.

## Problem statement

Specs drift from code. A spec is written, work happens, requirements change, and nothing re-asks "what does the spec still promise that the code does not deliver?" Spec Kit gives this its own phase (`/converge`): assess the codebase against spec/plan/tasks, append the remaining work.

arbiter already has the mechanism — it is simply pointed at a different target. `scripts/gen-gap.mjs` reads `docs/internal/PRODUCT/FEATURE_MATRIX.md` plus the constraint scan and writes `docs/internal/PRODUCT/GAP.md`: a gap register with v1 blockers, per-`REQ` gaps, severity, `blocks_v1` and issue references, with a `--check` mode for drift. `/levelup` does the analogous loop for gold level: audit, compose a remediation wave, re-audit under a no-regress ratchet.

So convergence exists and works — against the **RTM**, whose rows are already-declared requirements with a status ladder. It does not exist against a **specification**, because there is no spec artifact (#2359) and no spec↔plan link (#2365).

The difference matters. The RTM answers "which declared REQ rows are not yet Verified" — it converges against a checklist someone maintained. A spec answers "what did we say this should be" — including the decisions, constraints and non-goals that never became REQ rows. Converging against the RTM cannot surface a promise that was never entered into the RTM in the first place.

## Chosen approach

Point the existing engine at a second source rather than building a second engine.

`gen-gap.mjs` already has the right shape: read a declared-intent source, compare against observed state, emit a severity-rated register with issue references, and offer `--check` for drift. Extend it (or add a sibling mode) so the declared-intent source can be the spec corpus as well as the RTM, and so the emitted register distinguishes the two provenances.

The output feeds the backlog the way GAP.md already does: gaps become tracked issues, and the wave drains them. That is exactly the loop `/levelup` runs for gold level, so the orchestration pattern is established and does not need inventing.

## Key decisions and rejected alternatives

**D1 — Extend the existing engine; do not write a second gap generator.**
CANON-21 ("aggregate, don't proliferate") is directly on point, and `gen-gap.mjs` already implements read-intent → compare → severity-rate → emit → `--check`. A second generator would duplicate the register format, the severity vocabulary and the drift check, and the two would diverge. _Rejected_ a `gen-spec-gap.mjs` sibling unless the triage shows the comparison logic genuinely cannot share a spine.

**D2 — Blocked on #2359 and #2365, and honest about it.**
Converging against a spec needs a spec to converge against, and needs the spec↔plan link to know what "delivered" means. Filed as blocked rather than folded into #2359, so that issue stays shippable alone.

**D3 — The register distinguishes provenance.**
A gap derived from an RTM row and a gap derived from a spec promise are not the same claim: the first is a maintained checklist item, the second is an inferred obligation. Collapsing them would make the register less trustworthy, not more complete.

**D4 — Emits candidates, does not open issues autonomously.**
`gen-gap.mjs` writes a register; humans and the wave triage it. An engine that opened issues on its own would flood a backlog that already carries 24+ open items, and would violate the brainstorm/incidental-capture discipline that separates noticing from acting.

**D5 — Advisory `--check`, never a hard gate.**
"The code has drifted from the spec" is frequently the correct state mid-project. `gen-gap.mjs --check` exists to detect register staleness, not to fail a build for having unfinished work. Same posture here.

## Open questions

- Can the comparison spine really be shared? RTM rows carry explicit `code_ref`/`test_ref` anchors; spec promises carry prose. If mapping a spec promise to observed state requires a fundamentally different mechanism, D1 flips and a sibling is justified — that should be settled by inspection before implementation.
- Should `/levelup`'s remediation-wave composition be reused directly, or is spec convergence a different cadence (per-release rather than per-level)?
- Does convergence subsume the `docs/internal/SYSTEM/GAP.md` claim-inventory ("run #2000", 78 claims labelled VERO/FALSO/PARZIALE/VACUO), or is that a third, separate register that should stay separate?

---

## Acceptance Criteria

- [ ] AC-1: convergence against the spec corpus is implemented by extending `scripts/gen-gap.mjs` (or, if the triage in the open questions justifies it, by a sibling whose CATALOG argues explicitly why the spine could not be shared — CANON-21).
- [ ] AC-2: the emitted register distinguishes RTM-derived gaps from spec-derived gaps by provenance.
- [ ] AC-3: a `--check` mode reports drift and is advisory; no build fails for having unconverged work.
- [ ] AC-4: the existing RTM-derived behaviour of `gen-gap.mjs` and the current `docs/internal/PRODUCT/GAP.md` output are unchanged — proven by existing tests staying green.
- [ ] AC-5: spec-derived gaps are emitted as **candidates** in the register; no issue is opened autonomously.
- [ ] AC-6: a fixture spec promising something the code does not deliver produces exactly one spec-derived gap; a fully-delivered fixture produces none.
- [ ] AC-7: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No new hard gate.
- No autonomous issue creation.
- No change to `/levelup`, to the gold-audit ratchet, or to `docs/internal/SYSTEM/GAP.md`.
- Does not deliver the spec artifact (#2359) or the spec↔plan link (#2365).

## Files / contracts touched

- `scripts/gen-gap.mjs` — extended source + provenance in the register
- `docs/internal/PRODUCT/GAP.md` — register format gains provenance
- `src/generators/gap.ts` + its template — CANON-01 twin if the emitted register format changes
- `__tests__/scripts/` — fixtures for AC-4 and AC-6
- Contract: existing RTM-derived output unchanged; `--check` stays advisory

## Wave placement

Lane **E (spec chain)**, after #2365. **Blocked by #2359 and #2365.** Touches `scripts/gen-gap.mjs` and `docs/internal/PRODUCT/GAP.md`, which no other issue in this wave touches — parallel-safe once unblocked.
