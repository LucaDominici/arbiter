---
description: Single orchestration entrypoint — drive an issue to a reviewed, merged PR (#1206, #1216)
argument-hint: '#NNN [--tier XS|S|Standard]'
title: '/ship #NNN'
doc_version: '2.0.0'
status: active
last_review: '2026-06-05'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---










# /ship #NNN

`/ship` is the **single orchestration entrypoint** — it drives an issue to a reviewed, merged PR by
auto-sequencing arbiter's engine (worktree → plan → red-team → TDD impl → review → verify → merge → cleanup).
Use `/task` subcommands (`init`, `advance`, `record-red`, etc.) only for low-level engine control or recovery.

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

## Local-only state

Before writing task state, ensure runtime files never get committed:

```bash
mkdir -p .git/info .claude/plans
touch .git/info/exclude
for pattern in ".claude/.task-*" ".claude/.task/" ".claude/plans/" ".agents-dispatched" ".arbiter/"; do
  grep -qxF "$pattern" .git/info/exclude || printf "%s\n" "$pattern" >> .git/info/exclude
done
```

Then seed task state:

```bash
arbiter task init --id "#NNN" --plan ".claude/plans/task-NNN.md" --tier <tier>
arbiter task advance --to plan
```

---

## Phase map


The tier (XS / S / Standard) sets the number of review agents dispatched per review phase.


| Phase | What `/ship` does | Review agents |
|-------|-------------------|---------------|
| `preflight` | Open worktree (`/wt-open #NNN`), read issue, seed task state (see Local-only state above) | — |
| `plan` | Write the plan; pass the plan-review gate (`arbiter review plan`) | — |
| `red-team-review` | Dispatch tier-N red-team agents; route CRITICAL → `red-team-rework` | tier-N |
| `red` | Write failing tests (TDD red); `arbiter task record-red` | — |
| `green` | Implement the minimum to pass | — |
| `refactor` | Clean up; 1 self-review agent (trunk-solo mode) + 1 adversarial verifier | 1 |
| `verification` | Run the gate: `npm run test` then `node scripts/check-all.mjs check` | — |
| `complete` | Commit, push, open/merge PR, close issue, clean up | — |



---

## Gate economy (dev loop)

During `green` / `refactor` iteration, do **not** re-run `node scripts/check-all.mjs` — that
is the gate for the `verification` phase, and pre-commit / pre-push hooks already enforce it at
the boundary. Re-running it per edit wastes wall-clock.

Run only what covers the files you actually touched:
- the granular check script(s) whose scope includes the changed file(s),
- `npm run test run <path>` for added or changed tests,
- a formatter `--check` on just the edited files.

Resolve everything in one work session, then let the `verification` phase run the full gate
once. This is a **speed** optimization, not a gate skip — the full gate still runs before
commit (L1) and before push (L2).

---

## Red-team review


After advancing to `red-team-review`, dispatch **N parallel agents** (XS=1, S=2, Standard=3). Each agent
self-selects an attack angle from: `security`, `concurrency`, `performance`, `edge-cases`, `regression`,
`dependency`, `data-integrity`, `error-handling`.

**Evidence path:** `.arbiter/evidence/redteam/<task-id>.json` (schema: `RedTeamEvidenceV1`).

**Forward-link to code-review (#1212):** record each finding in the unified task document as
`redTeamFindings` — `{ id: "RT-01", severity, summary, auditorHint, resolved: false }` — where
`auditorHint` names the `auditor-routing.json` auditor whose remit covers the finding. At code-review,
every still-`resolved:false` finding caps its mapped auditor's verdict score and is tagged
`[RT-xx UNRESOLVED]`. Flip `resolved` to `true` once addressed.

| Impact | Action |
|--------|--------|
| CRITICAL | `arbiter task advance --to red-team-rework` → revise plan → re-run red-team-review |
| HIGH / MEDIUM | Adapt plan in-place before advancing |
| SUGGESTION | Note only — no blocking |



---

## Refactor / code-review evidence



**Solo review — self-audit pass (1 agent):**

Dispatch a single self-review agent covering: bugs & logic errors, type safety, domain consistency
(AGENTS.md / ADRs), silent failures (swallowed exceptions, wrong fallbacks).

```bash
# Record dispatch evidence — fail-closed Stop hook (INV-114) reads branch+sha from this file
mkdir -p .arbiter && printf '{"count":1,"branch":"%s","sha":"%s"}\n' "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse HEAD)" > .arbiter/agents-dispatched.json
```

**HARD STOP** if self-review agent was not actually dispatched.



**Adversarial Verifier (mandatory, after review):** Trace each new feature end-to-end; check dead code,
CLI option wiring end-to-end (flag declared → parsed → forwarded), fixture assumptions and test setup.

**Acceptance criteria:** Re-read the original issue. For each acceptance criterion state:
PASS / FAIL / NOT TESTED. Any FAIL blocks advance.



---

## Merge step



**peer-review / gated-review (or pr-ff):** open a PR and merge once checks pass:

```bash
gh pr create --title "type(#NNN): summary" --body "Fixes #NNN"
gh pr checks --watch
gh pr merge --merge
```


---

## Complete

```bash
node scripts/done-evidence.mjs
```

Close the issue:


```bash
gh issue close NNN
```


Advance to the terminal phase and close the worktree:

```bash
arbiter task advance --to complete
arbiter wt close NNN
```

---

## Plan mode (auto)

At the **start of the `plan` phase** — and only when `.claude/.task/status.json` shows `phase` ∈
{`preflight`, `plan`} — call `EnterPlanMode` to enforce no-edit discipline while drafting the plan.
Do NOT call EnterPlanMode when resuming an exec phase (check the phase-doc first).

At **GO/handoff** (plan-review gate green):
1. Call `ExitPlanMode`.
2. Advance to red-team-review (no units yet — `checkHandoffGate` is not triggered here):
   ```bash
   arbiter ship #NNN --advance
   ```
3. After red-team-review completes, advance to **red** with the unit count from the plan (§7):
   ```bash
   arbiter ship #NNN --advance --units <N>
   ```
   This is the transition where `checkHandoffGate` fires and the size-driven strategy applies.
4. Follow the printed banner: it shows the strategy (`inline` / `sub-agent` / `stop`) and the
   exact resume steps (use `--post-clear` on re-entry after a `/clear`).

---

## Hard stops

- A phase gate throws (plan-review FAIL, TDD evidence missing, budget breach) → fix the root cause; do
  not bypass. `arbiter ship --advance` surfaces the gate's exit code (78 handoff, 79 budget).
- CRITICAL red-team finding → `arbiter task advance --to red-team-rework`, revise, re-run review.
- If `tasks.worktree` is `always` in `arbiter.json`, opening a worktree is mandatory — HARD STOP if skipped.
- The fail-closed Stop hook (INV-114) requires three correlated artifacts before any completion claim:
  plan-review `latest.json` (written by `arbiter review plan`), `.arbiter/agents-dispatched.json`
  (written in the refactor section above), `.arbiter/gate-pass.json` (written by the gate). The
  `phase: complete` state releases the guard.
- Never skip the gate, never commit to `main` outside the merge step, never leave the loop mid-phase
  without an `arbiter mark` cursor.
