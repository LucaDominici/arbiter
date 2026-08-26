---
title: 'Structured Clarification Loop — beyond a binary readiness verdict'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/issue-readiness.mjs', 'scripts/lib/acceptance-criteria.mjs']
---

# Structured Clarification Loop — beyond a binary readiness verdict

Readiness is a binary verdict; there is no loop that actually enriches an underspecified issue.

## Problem statement

`scripts/issue-readiness.mjs` is the entry gate upstream of every wave: no issue enters `/ship preflight` until its "done right" target is written in the issue. It parses the body via `scripts/lib/acceptance-criteria.mjs::assessReadiness` and returns `{ready, missing[]}`, where `missing` can contain exactly four shapes: no `AC-N` checkbox found, a checkbox without an explicit stable id, only stock template lines, an empty non-goals section, an empty files/contracts section.

That is a **structural** verdict, and it is binary. It answers _whether_ the required sections exist; it cannot answer whether what they contain is unambiguous, complete, or self-consistent. `renderClarificationComment` posts the four generic bullets back to the issue and the author is left to guess what specifically was underspecified.

Spec-driven development treats this as its own phase — Spec Kit's `/clarify` runs a targeted question loop before planning, on the argument that underspecification is cheapest to pay _before_ dispatch. arbiter agrees with the argument (the gate's own header says "Underspecification is paid as a prompt BEFORE dispatch, not as a thrown-away PR after") but implements only the check, not the loop.

The consequence is a false negative that is invisible: an issue with three vacuous-but-well-formed `AC-N` lines, a non-goals section reading "none", and a files section listing `src/` passes `assessReadiness` cleanly and enters the wave. The gate cannot tell it apart from a genuinely specified issue.

## Chosen approach

Add a clarification **loop** on top of the existing structural gate, without touching the gate's contract.

The gate stays exactly as it is — pure, deterministic, no network, exit 0/1/2 — and remains the hard entry condition. The loop sits above it as an orchestration-time step: when readiness passes structurally, an agent reads the issue against a rubric of ambiguity classes and produces **targeted** questions (naming the specific criterion and what is undecidable about it), which are posted as a single comment for the author. The author's answers are folded back into the issue body, and readiness is re-run.

The rubric is the substance: a criterion that is not observable, a criterion whose subject is undefined, a non-goal that contradicts a criterion, a files section that does not cover the criteria, an acceptance criterion with no verification method. These are checkable by reading, not by parsing, which is why the loop is agent-shaped and the gate is script-shaped.

## Key decisions and rejected alternatives

**D1 — Do not put judgement into the gate.**
`assessReadiness` is pure, offline and deterministic, and `check-acceptance.mjs` depends on it at L1. Adding LLM judgement would make an L1 gate non-deterministic and network-dependent. _Rejected_ extending `assessReadiness` with quality heuristics: the structural check and the semantic check have different determinism requirements and belong in different layers.

**D2 — The loop is advisory to the author, never auto-editing the issue.**
Questions are posted; answers are the author's. An agent that rewrites acceptance criteria on its own would be inventing the intent it is supposed to elicit — precisely the failure INV-138 exists to prevent by freezing the issue's AC-N _verbatim_. _Rejected_ auto-enriching the body.

**D3 — One comment, not a conversation.**
The existing `needs-clarification` mechanism posts one comment and labels the issue. The loop reuses that shape: a single comment with specific questions, then the author removes the label to re-enter the queue. _Rejected_ a multi-turn thread: it would stall waves and put an agent in an open-ended conversation with no terminal state.

**D4 — Bounded, and it must be able to say "nothing to ask".**
An agent asked to find ambiguity will always find some. The rubric is a closed list of classes and the loop must be allowed to return zero questions; otherwise it becomes ceremony that every issue pays. A run that produces no questions is the expected outcome for a well-written issue.

**D5 — Reuse `assessReadiness`, do not fork the grammar.**
The loop reads the same parsed blocks (`parseAcceptanceBlocks`) so that "criterion 3" means the same thing to both layers. Forking the parser would let the two disagree about what the criteria even are.

## Open questions

- Where does the loop run — inside `/ship preflight` (paid per issue, blocks the ship) or inside wave composition (paid once per wave, before dispatch)? The wave is the cheaper place, but preflight is where a solo `/ship` would need it.
- Does this deserve a skill of its own, or is it a step inside `wave-drain` Phase 0 triage? A skill is discoverable; a step is cheaper.
- Should the rubric's classes be derived from real rework data? `.arbiter/rework/ledger.jsonl` exists and is a committed dataset — if it records why work was reworked, it could tell us which ambiguity classes actually cost money, instead of guessing.

---

## Acceptance Criteria

- [ ] AC-1: a documented rubric of ambiguity classes exists (non-observable criterion, undefined subject, non-goal contradicting a criterion, files section not covering the criteria, criterion with no verification method).
- [ ] AC-2: the loop consumes `parseAcceptanceBlocks` from `scripts/lib/acceptance-criteria.mjs` and does not fork the grammar.
- [ ] AC-3: `scripts/issue-readiness.mjs` and `scripts/lib/acceptance-criteria.mjs` keep their current behaviour, purity and exit-code contract — proven by the existing tests staying green unmodified.
- [ ] AC-4: the loop emits **targeted** questions naming the specific criterion, not the four generic `missing` bullets; a worked example is included in the docs.
- [ ] AC-5: the loop can return zero questions, and a well-specified fixture issue produces zero — proving it is not ceremony.
- [ ] AC-6: the loop never edits the issue body or the acceptance criteria; it only posts questions (INV-138 verbatim-freeze respected).
- [ ] AC-7: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No change to `assessReadiness`'s structural rules or to the `needs-clarification` label mechanism.
- No LLM judgement inside any L1 gate.
- No multi-turn conversation with the author; one comment, then the label gates re-entry.
- No auto-generation or auto-editing of acceptance criteria.

## Files / contracts touched

- The clarification loop — new skill or `wave-drain` Phase 0 step (per the open question)
- `scripts/lib/acceptance-criteria.mjs` — consumed read-only, not modified
- `scripts/issue-readiness.mjs` — unchanged (AC-3)
- `docs/` — the rubric
- Contract: `issue-readiness` exit codes and `assessReadiness` purity unchanged

## Wave placement

Lane **G (requirements quality)**. `conflicts-with:#<G7 issue>` — both read/extend the acceptance-criteria rubric surface; serial lane.
