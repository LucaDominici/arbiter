---
title: 'Requirements-Quality Rubric — the checklist that points at requirements'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/lib/acceptance-criteria.mjs', 'docs/internal/SYSTEM/CANON.md']
---

# Requirements-Quality Rubric — the checklist that points at requirements

Every quality checklist in arbiter points at the code; none points at the requirements.

## Problem statement

arbiter has an unusually deep bench of code-side quality mechanisms: 143 gate scripts, 137 invariants, the `clean-code` gate-map skill, `verification`, `architect-review`, `codebase-audit`, `red-team`, the conformance scorecard's 7 dimensions, the KIT catalog's 78 dimensions.

**None of them assess the quality of a requirement.** The only requirement-side check is `assessReadiness` (structural presence of AC-N / non-goals / files sections). There is no counterpart to Spec Kit's `/checklist`, which generates a validation checklist over requirements _completeness, clarity and consistency_.

This is the mirror image of the project's strength and its cost is asymmetric: a defect in a requirement propagates through plan, tests and code, and every downstream gate faithfully verifies the wrong thing. INV-138 makes this concrete — it freezes the issue's AC-N _verbatim_ into the plan and demands a per-criterion `ac-fit` verdict. That machinery guarantees the implementation matches the criteria; it cannot notice that the criteria were the wrong ones. A vacuous criterion produces a green `ac-fit`.

Related but distinct from the clarification-loop issue (#2363): that one asks the author targeted questions about a _specific_ issue before dispatch. This one is a reusable rubric that can be run over a requirement set — an issue, a spec, an epic — and produces a checklist of what a good requirement set must satisfy.

## Chosen approach

A documented, reusable **requirements checklist** with a small number of checkable properties, plus a skill that applies it and reports per-property verdicts.

Candidate properties, kept deliberately few:

- **Observable** — each criterion names a state or behaviour an outside party could witness.
- **Verifiable** — each criterion implies a method (a test, a command, an artifact) by which it is judged.
- **Atomic** — each criterion fails for one reason, not several.
- **Non-overlapping** — no two criteria assert the same thing.
- **Bounded** — the non-goals actually exclude something a reasonable reader might have assumed included.
- **Covered** — the files/contracts section spans what the criteria imply.

Output is a per-property verdict with citations back into the requirement text, in the shape arbiter already uses for reviews. It is advisory: it informs the author, it does not block, and it never edits the requirement.

## Key decisions and rejected alternatives

**D1 — A rubric, not a gate.**
Requirement quality is a judgement over prose. Mechanising it into a blocking check would either be trivially satisfiable (word counts, section presence — which `assessReadiness` already does) or non-deterministic in an L1 gate. _Rejected_ a `check-requirements-quality.mjs`: CANON-22 is explicit that only Tier-1 empirically-validated metrics may hard-gate, and there is no evidence base for a mechanical requirement-quality score.

**D2 — Share the rubric with the clarification loop, do not duplicate it.**
#2363 needs a list of ambiguity classes; this issue needs a list of quality properties. They are the same list read from two directions ("what is wrong here" vs "what must be true"). One SSOT, two consumers. _Rejected_ two independent rubrics: they would drift, and a finding would be phrased differently depending on which entry point surfaced it.

**D3 — Few properties, or it will not be used.**
Six properties that fit on a screen get applied; a thirty-item checklist gets skipped and then cited as if it had been applied — the worst outcome, and one the anti-proforma gates exist to catch elsewhere. If the list grows, it should grow from observed rework, not from completeness instinct.

**D4 — Advisory, and it must be able to pass cleanly.**
Same reasoning as #2363 D4: a reviewer instructed to find requirement defects will find them. A well-written issue must produce a clean verdict, or the rubric is ceremony.

**D5 — Applies to issues today, specs later.**
The natural subject is a durable spec, which does not exist yet (#2359). Until it does, the subject is the issue body — the same `parseAcceptanceBlocks` surface. Designing it against the parsed blocks rather than against "an issue" means it transfers to specs unchanged when they arrive.

## Open questions

- Is there evidence for which properties actually matter? `.arbiter/rework/ledger.jsonl` is a committed rework dataset; if it attributes rework causes, it could ground this list empirically instead of by intuition — which is what CANON-22 would want before anyone proposes promoting any of it to a gate.
- Should the checklist be run at issue creation, at wave composition, or on demand? On demand is cheapest to ship and lets usage decide.
- Does this overlap `epic-decompose` enough to live there instead? Both reason about whether a unit of work is well-formed, but decomposition is about size and dependencies rather than requirement quality.

---

## Acceptance Criteria

- [ ] AC-1: a documented requirements-quality rubric exists with a small closed set of properties (observable, verifiable, atomic, non-overlapping, bounded, covered), each with a one-line test for how it is judged.
- [ ] AC-2: the rubric is a single SSOT shared with the clarification loop (#2363); neither consumer forks its own copy.
- [ ] AC-3: a skill applies the rubric to a requirement set and reports a per-property verdict with citations into the requirement text.
- [ ] AC-4: the output is advisory — no gate blocks on it, and no L1 check gains LLM judgement (CANON-22 respected).
- [ ] AC-5: the rubric never edits the requirement text (INV-138 verbatim-freeze respected).
- [ ] AC-6: a well-written fixture issue produces a clean verdict on every property — proving the rubric is not ceremony.
- [ ] AC-7: the implementation reads `parseAcceptanceBlocks` so it transfers to durable specs (#2359) unchanged.
- [ ] AC-8: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No blocking gate and no mechanical requirement-quality score (CANON-22).
- No change to `assessReadiness`, `issue-readiness.mjs`, INV-138 or the `ac-fit` mechanism.
- No auto-rewriting of requirements.
- No dependency on durable specs existing — the issue body is the subject until they do.

## Files / contracts touched

- `docs/` — the rubric (shared SSOT with #2363)
- A new skill under `.claude/skills/` — the applier
- `scripts/lib/acceptance-criteria.mjs` — consumed read-only
- `.claude/AGENT_REGISTRY.md` and rule `05-agent-lifecycle` bookkeeping if a subagent is added
- Contract: no gate, no config, no runtime behaviour changes

## Wave placement

Lane **G (requirements quality)**, after #2363. `conflicts-with:#2363` — both own the shared rubric SSOT; serial lane, same worktree.
