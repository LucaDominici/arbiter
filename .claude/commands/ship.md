---
description: Drive an issue to a reviewed, merged PR by orchestrating the existing engine (#1206)
argument-hint: '#NNN [--tier XS|S|Standard]'
title: '/ship #NNN'
doc_version: '1.0.0'
status: active
last_review: '2026-06-04'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /ship #NNN

Drive an issue toward a **reviewed, merged PR** by auto-sequencing arbiter's existing engine
(worktree → plan → review-plan gate → TDD impl → review-code → verify → gate → merge → cleanup).
`/ship` is the self-driving loop over `/task`'s primitives — it sits **alongside** `/task`, it does
not replace it.

> Semantics: `ship` = drive an issue to a merged PR. It is NOT deploy/release.

---

## The loop

`arbiter ship` is the next-action computer; this command is the loop that executes the model-requiring
steps between its calls.

```bash
# 1. Ask the orchestrator for the current step
arbiter ship #NNN --tier <tier>

# 2. Do the work the step describes (plan / write tests / implement / dispatch review agents)

# 3. Advance when this phase's gate is green (the gate throws if red)
arbiter ship #NNN --advance

# repeat 1–3 until the step reports "Phase: complete (done)"
```

On every sub-step, pin the cursor so a mid-task `/clear` resumes exactly:

```bash
arbiter mark --tdd GREEN --last "<done>" --next "<exact next action>" --digest "<one line>"
```

---

## Phase map

The tier (XS / S / Standard) sets the number of review agents dispatched per review phase.

| Phase             | What `/ship` does                                                    | Review agents |
| ----------------- | -------------------------------------------------------------------- | ------------- |
| `preflight`       | Open worktree, read issue, `arbiter task init`                       | —             |
| `plan`            | Write the plan; pass the plan-review gate (`arbiter review plan`)    | —             |
| `red-team-review` | Dispatch tier-N red-team agents; route CRITICAL → `red-team-rework`  | tier-N        |
| `red`             | Write failing tests (TDD red); `arbiter task record-red`             | —             |
| `green`           | Implement the minimum to pass                                        | —             |
| `refactor`        | Clean up; dispatch 4 code-review agents + 1 adversarial verifier     | 4 (Standard)  |
| `verification`    | Run the gate: `npm run test` then `node scripts/check-all.mjs check` | —             |
| `complete`        | Commit, push, open/merge PR, close issue, clean up                   | —             |

Review-agent minimums by tier: XS=3, S=3, Standard=4.

---

## Merge step

**peer-review / gated-review (or pr-ff):** open a PR and merge once checks pass:

```bash
gh pr create --title "type(#NNN): summary" --body "Fixes #NNN"
gh pr checks --watch
gh pr merge --merge
```

---

## Hard stops

- A phase gate throws (plan-review FAIL, TDD evidence missing, budget breach) → fix the root cause; do
  not bypass. `arbiter ship --advance` surfaces the gate's exit code (78 handoff, 79 budget).
- CRITICAL red-team finding → `arbiter task advance --to red-team-rework`, revise, re-run review.
- Never skip the gate, never commit to `main` outside the merge step, never leave the loop mid-phase
  without an `arbiter mark` cursor.
