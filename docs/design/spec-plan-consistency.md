---
title: 'Spec-Plan Consistency — the one cross-artifact link arbiter cannot verify'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/check-acceptance.mjs', 'schemas/agent-return.schema.json']
---

# Spec-Plan Consistency — the one cross-artifact link arbiter cannot verify

The one cross-artifact link arbiter cannot verify, because one end of it does not exist.

## Problem statement

arbiter's cross-artifact consistency coverage is strong but has exactly one hole.

Verified today:

- **plan ↔ code**: `pre-edit-plan-anchor.mjs` blocks edits outside the plan's `files:` manifest, and `check-touched-vs-manifest.mjs` audits the read-set.
- **criteria ↔ implementation**: `check-acceptance.mjs` (INV-138) requires the issue's `AC-N` frozen verbatim into the plan, and a per-criterion `ac-fit` artifact with a cited proving `file:line`.
- **requirement ↔ code ↔ test**: FEATURE_MATRIX's RTM with `code_ref`/`test_ref`/`doc_ref`, fail-closed ladder, `verification_tier`.

Missing: **spec ↔ plan**. Nothing verifies that a plan is faithful to the specification it claims to implement — because, today, there is no durable specification artifact to compare against (#2359).

The practical hole is narrow but real. INV-138 guarantees the plan carries the issue's criteria verbatim and that each is met. It cannot notice that the plan _also_ does three things the spec explicitly listed as non-goals, or that it silently drops a constraint the spec stated as a decision. Criteria are atomic and observable by design; the surrounding decisions, constraints and rejected alternatives are exactly the material AC-N are not meant to carry — and exactly what a plan can quietly contradict.

This is Spec Kit's `/analyze` axis. It is the last unclosed link once #2359 lands.

## Chosen approach

An **advisory** consistency check that reads a spec and the plan claiming to implement it, and reports contradictions in three closed classes:

- **non-goal violation** — the plan proposes work the spec listed as a non-goal;
- **dropped decision** — the plan contradicts, or silently omits, a decision the spec recorded;
- **uncovered criterion** — the spec implies a criterion that no `AC-N` in the plan covers.

Each finding cites both ends: the spec line and the plan line. Reuses the `arbiter-agent-return-v1` envelope with M12 citation enforcement, so the output enters the existing evidence pipeline rather than inventing a format.

Wiring follows the E1–E6 adoption path: `runWarnCheck` first, promoted only once a corpus of real spec/plan pairs exists.

## Key decisions and rejected alternatives

**D1 — Blocked on #2359, and honest about it.**
There is nothing to compare until a durable spec artifact exists. This issue is deliberately filed as blocked rather than folded into #2359, so that #2359 stays shippable on its own and this work is not used to justify inflating it. _Rejected_ merging the two: it would make the spec artifact contingent on a gate that may not earn its place.

**D2 — Advisory, and possibly permanently so.**
Judging "the plan contradicts a recorded decision" is a reading, not a parse. CANON-22 restricts hard gates to Tier-1 empirically-validated metrics. This may legitimately stay `runWarnCheck` forever; promotion requires evidence that it catches real defects at an acceptable false-positive rate, not merely that it runs. _Rejected_ designing it as a hard gate from the start.

**D3 — Three closed classes, not open-ended "review the plan".**
An open mandate would re-review the plan and duplicate the plan-review phase that already exists. The value here is specifically the _spec↔plan_ delta, which no other phase looks at. Closed classes keep it from expanding into a second plan review.

**D4 — Reuse the existing envelope and citation rules.**
`arbiter-agent-return-v1` with M12 (a structural finding needs a resolvable `file:line`) already exists and is validated by `check-agent-return.mjs`. A finding that cannot cite both ends is not actionable and should not be emitted. _Rejected_ a bespoke report format.

**D5 — Reads only; never reconciles.**
When spec and plan disagree, which one is wrong is a human decision — sometimes the plan learned something the spec did not know. Auto-amending either would destroy that signal.

## Open questions

- Where does it run: the `plan` phase (before implementation, cheapest to act on) or `verification` (where the plan is final)? The plan phase is the better economics but the plan is still moving.
- Does "dropped decision" produce an acceptable false-positive rate at all? A plan legitimately omits decisions that turned out irrelevant. This class may need to be dropped after measurement — which is the honest outcome if the data says so.
- Should the spec↔plan check subsume `check-acceptance`'s coverage question, or stay strictly complementary? Strictly complementary is safer: INV-138 is a hard gate and must not gain a soft dependency.

---

## Acceptance Criteria

- [ ] AC-1: the check reads a durable spec artifact (per #2359) and the active plan, and reports findings in exactly three closed classes: non-goal violation, dropped decision, uncovered criterion.
- [ ] AC-2: every finding cites **both** ends — a spec `file:line` and a plan `file:line` — and findings that cannot cite both are not emitted.
- [ ] AC-3: output is an `arbiter-agent-return-v1` envelope passing `check-agent-return.mjs` including M12 citation resolution; no bespoke report format is introduced.
- [ ] AC-4: wired into `check-all.mjs` as `runWarnCheck`, with a vacuous explicit skip (never a faked pass, INV-115) when no spec exists for the active task.
- [ ] AC-5: `check-acceptance.mjs` (INV-138) is unmodified and gains no dependency on this check.
- [ ] AC-6: the check never edits the spec or the plan.
- [ ] AC-7: a fixture pair with a planted non-goal violation is detected; a faithful fixture pair produces zero findings.
- [ ] AC-8: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No hard gate, and no promotion to `runCheck` in this issue (requires evidence per CANON-22).
- No second plan review: only the spec↔plan delta, in three classes.
- No auto-reconciliation of spec and plan.
- No change to INV-138, `ac-fit`, `pre-edit-plan-anchor` or `check-touched-vs-manifest`.
- Does not deliver the spec artifact itself — that is #2359.

## Files / contracts touched

- A new advisory check + its `// CATALOG:` justification (CANON-21), with the rejected fold-ins against `check-acceptance.mjs` and the plan-review phase argued explicitly
- `scripts/check-all.mjs` — `runWarnCheck` wiring
- `src/templates/` — CANON-01 twin
- `__tests__/scripts/` — the planted-violation fixtures (AC-7)
- Contract: `arbiter-agent-return-v1` reused unchanged; INV-138 untouched

## Wave placement

Lane **E (spec chain)**, last. **Blocked by #2359** — cannot start until a durable spec artifact exists. `conflicts-with:#2359` only if it ends up touching FEATURE_MATRIX; otherwise parallel-safe once unblocked.
