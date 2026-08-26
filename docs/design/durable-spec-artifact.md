---
title: 'Durable Spec Artifact — closing the open end upstream'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['docs/internal/PRODUCT/FEATURE_MATRIX.md', 'scripts/check-acceptance.mjs']
---

# Durable Spec Artifact — closing the open end upstream

A durable, traceable specification artifact — closing the open end upstream (spec → AC-N → RTM).

## Problem statement

Comparing arbiter against spec-driven development for AI models (reference: GitHub Spec Kit, `/constitution → /specify → /clarify → /plan → /tasks → /analyze → /implement`), arbiter **wins clearly on most axes**:

- the _constitution_ is stronger and, crucially, **mechanically enforced**: AGENTS.md + 137 invariants + 23 CANON rules + 116 ADRs with an explicit authority hierarchy, whereas Spec Kit writes the constitution and does not enforce it;
- the _plan_ is superior: mandatory sections, Existing Code Survey (CANON-16), gated plan review, `pre-edit-plan-anchor` blocking edits outside the manifest;
- _traceability_ is superior: FEATURE_MATRIX `REQ-NNN` with `code_ref`/`test_ref`/`doc_ref`/`issue_ref`, a fail-closed `Missing→Partial→Done→Verified` ladder, `verification_tier` IQ/OQ/PQ.

But there is **one open end**: no durable specification artifact exists. The only spec-like artifact is `.arbiter/design/<topic-slug>.md` produced by the `brainstorming` skill, and `.gitignore:28` + `:58` keep it **deliberately untracked** (#1770). The only durable container for intent is therefore the GitHub issue body. (That contradiction is tracked separately as #2361 and is a prerequisite here.)

Two verifiable consequences:

1. **The spec↔plan link is missing** from cross-artifact consistency analysis. `check-acceptance.mjs` (INV-138) and `check-touched-vs-manifest.mjs` cover plan↔code↔test very well, but cannot verify that a plan is faithful to a specification, because the specification does not exist as a queryable artifact.
2. **Intent lives only in an issue's AC-N.** AC-N are excellent as _acceptance criteria_, but they are deliberately observable and atomic: they are not where rationale, motivated non-goals, rejected alternatives and constraints live. That material is lost today, or survives by accident in an ADR.

The gap is not "arbiter is worse than Spec Kit". It is that arbiter already has the most serious traceability machine among its peers and does not anchor it upstream.

## Chosen approach

Introduce a **committed, machine-readable** specification artifact, hooked into structures that already exist rather than importing a second framework.

The key hook: the spec **is the source of the AC-N** that INV-138 already freezes into the plan, and becomes the `source_ref` that FEATURE_MATRIX already provides as an optional column (today accepting `INV-NN`, `ADR-NNN`, `PRD §N`). The chain becomes:

```
spec (SPEC-NNN) → AC-N frozen into the plan (INV-138) → per-criterion ac-fit → RTM row with source_ref
```

No new pipeline, no `/specify` command: `brainstorming` is reused as the divergence phase (it already produces exactly this material and already has the correct terminal state), promoting its output from ephemeral note to tracked artifact.

## Key decisions and rejected alternatives

**D1 — Reuse `brainstorming`, do not add a `/specify` command.**
The `brainstorming` skill already produces Problem statement, options with tradeoffs, a decision, rejected alternatives, open questions — i.e. the content of a spec — and already has the right terminal contract (STOP, no implementation, enforced by the `post-brainstorm-stop.mjs` hook). What is needed is to promote its output, not to add a second path alongside it. _Rejected_ replicating Spec Kit's pipeline: it would add four commands duplicating `plan`, `epic-decompose` and `gen-gap`, which arbiter already has and does better.

**D2 — The `.gitignore` contradiction is a prerequisite, tracked as #2361.**
Today `brainstorming/SKILL.md` prescribes a **committed** design doc and `.gitignore:58` deliberately excludes it (#1770). That must be resolved before a spec path means anything; it is split out as #2361 so the decision (and its argument against #1770's rationale) is made on its own merits. If #2361 chooses to move design docs to a versioned path, it supersedes part of this issue.

**D3 — `source_ref` is the hook, and it already exists.**
FEATURE_MATRIX already has the optional `source_ref` column as an "upward anchor". Adding `SPEC-NNN` to its vocabulary extends an existing structure rather than inventing one. That is why this gap is closable cheaply.

**D4 — AC-N derive from the spec, they do not replace it.**
INV-138 already freezes an issue's AC-N into the plan and demands a per-criterion `ac-fit`. The spec does not touch that mechanism: it gives it a provenance. The spec answers _why_ and _what we will not do_; AC-N answer _how you observe it is done_.

**D5 — The gate comes later, advisory.**
A spec↔plan consistency check is the valuable part, but also the part that most easily becomes ceremony. It should be introduced only after real specs exist, advisory first, following the E1–E6 adoption path. _Rejected_ introducing artifact and gate together: it would fail on every existing tree.

**D6 — No retroactive obligation.**
The open issues and existing FEATURE_MATRIX REQ rows are not rewritten. The spec is opt-in for new work, exactly as `acceptanceAnchor` is flag-gated.

## Open questions

- **The central question, which decides the shape of everything else:** where do specs live? `docs/specs/SPEC-NNN-<slug>.md` (versioned, consistent with the doc hierarchy, but subject to doc-freshness/style/links gates) or `.arbiter/design/` with a `.gitignore` negation (consistent with the current skill, but against #1770's intent)? This overlaps #2361 and should be decided once, in whichever lands first.
- Must a spec be a new numbered entity (`SPEC-NNN`), or _is_ the GitHub issue the spec, needing only a durable and citable body? The latter is cheaper but ties traceability to GitHub, whereas `decomposition.backend` also supports `markdown`.
- If a spec changes after code is written, what should happen? That is Spec Kit's `/converge` case, and arbiter already has `gen-gap.mjs` doing exactly this against FEATURE_MATRIX — tracked separately as the convergence issue.

---

## Acceptance Criteria

- [ ] AC-1: an explicit, documented decision on spec placement (versioned vs `.arbiter/` with a negation) exists, with the rationale relative to #1770 recorded in an ADR, consistent with whatever #2361 decided.
- [ ] AC-2: a documented spec format exists with mandatory sections (problem, chosen approach, decisions and rejected alternatives, non-goals, open questions) and a stable id.
- [ ] AC-3: the `source_ref` vocabulary in FEATURE_MATRIX accepts the spec id, and `scripts/check-feature-matrix.mjs` recognises it as a valid anchor.
- [ ] AC-4: at least one real spec exists in the repo and one FEATURE_MATRIX row cites it via `source_ref` — the chain is demonstrated, not merely described.
- [ ] AC-5: the path is **opt-in**: no open issue and no existing REQ row becomes non-conformant, and no existing gate flips from green to red.
- [ ] AC-6: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No blocking spec↔plan consistency gate in this issue (advisory and later, once real specs exist) — tracked separately.
- No retroactive rewrite of open issues or existing RTM rows.
- No import of Spec Kit and no replication of its commands (`/specify`, `/clarify`, `/tasks`, `/analyze`): `plan`, `epic-decompose` and `gen-gap` already cover those axes.
- No change to INV-138, to AC-N, or to the `ac-fit` mechanism.
- Resolving the `brainstorming` / `.gitignore` contradiction itself — that is #2361.

## Files / contracts touched

- `docs/internal/ADR/` — new ADR for the placement decision (AC-1)
- The spec path — new (`docs/specs/` or `.arbiter/design/`, per AC-1)
- `docs/internal/PRODUCT/FEATURE_MATRIX.md` + `scripts/check-feature-matrix.mjs` — `source_ref` vocabulary
- `src/templates/docs/FEATURE_MATRIX.md.ejs` — CANON-01 twin if the vocabulary changes on the template side
- Contract: INV-138, `ac-fit` and the RTM ladder stay unchanged; the path is additive and opt-in

## Wave placement

Lane **E (spec chain)**, after #2361. `conflicts-with:#2361` (both touch `.gitignore` / `SKILL.md` / the spec path) — serial lane, same worktree.
