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

Every `arbiter ship` call also prints an **Affinity** line for the issue (computed automatically — no
flag): its best correlation score against open same-milestone siblings vs the threshold. A
`WARN low affinity` line means the issue is solo or weakly correlated to its siblings — verify it is
well-scoped and not entangled before batching. The warning is advisory and never blocks the ship.

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

`arbiter ship` **always auto-computes the issue size** (no flag) and selects this tier from it: the change diff (files + LOC), falling back to the plan unit estimate, then to the widest tier as a fail-safe. `--tier` stays a rare manual override. Size drives BOTH the review-agent **count** (above) AND the **orthogonal vertical breadth** — larger size widens the set of review verticals (`bugs`, `type-safety`, `domain` → `+test-quality` → `+security`, `+data-integrity`, `+silent-failures`). Treat the selected tier as the floor for review breadth: widen the active verticals to match the size, not just the agent count.


| Phase | What `/ship` does | Review agents |
|-------|-------------------|---------------|
| `preflight` | Open worktree (`/wt-open #NNN`), read issue, seed task state (see Local-only state above) | — |
| `plan` | Write the plan; pass the plan-review gate (dispatch review agents, write `.arbiter/evidence/plan-review/<id>/latest.json` with verdict `PASS`) | — |
| `red-team-review` | Dispatch tier-N red-team agents; route CRITICAL → `red-team-rework` | tier-N |
| `red` | Write failing tests (TDD red); `arbiter task record-red` | — |
| `green` | Implement the minimum to pass (composes with active companion plugins — see below) | — |
| `refactor` | Clean up; 1 self-review agent (trunk-solo mode) + 1 adversarial verifier | 1 |
| `verification` | Run the gate: `npm run test` then `node scripts/check-all.mjs check` | — |
| `complete` | Commit, push, open/merge PR, close issue, clean up | — |



---

## Companion plugins

`arbiter ship` is **companion-aware**. If a known companion plugin (first-class: **ponytail**, a
YAGNI drafting persona) is installed in your Claude home, the `green` step composes with it and every
step announces which companions are active:

```
Companion: ponytail (full) · arbiter gates remain the safety net
```

- **Detected HOME-only** — a companion is a per-user tool choice; your repo is never scanned, so a
  cloned repo can never force a companion on you.
- **`lite` / `full`, never `ultra`** — ultra skips tests, incompatible with TDD.
- **Graceful** — no companion installed ⇒ ship is byte-identical to before (no `Companion:` line).
- **Gates stay authoritative** — if the persona cuts too much, your gate catches it.

Configure in `arbiter.json` (optional): `companions.ponytail.enabled=false` disables it;
`companions.ponytail.mode="lite"` or `"full"` wins explicitly. Without an override, arbiter
uses a conservative stack default: `java`, `kotlin`, and `csharp` resolve companions to `lite`;
other stacks (including TypeScript/JavaScript/Python) stay on the policy default `full`.
`ultra` is never representable. arbiter never vendors a companion's code.

---

## FEATURE_MATRIX (consume at plan, maintain at verification)

The project's `FEATURE_MATRIX.md` is the product RTM. /ship keeps it from being write-only ceremony by
**reading it at `plan`** and **updating it at `verification`** — so it drives the next action instead
of just being audited by the gate.

**At `plan`** — find the REQ row(s) this issue advances (match on the `issue_ref` column):

```bash
grep -rnE "REQ-[0-9]+" --include=FEATURE_MATRIX.md . | grep "#NNN"
```

If a row matches, surface its `feature_id`, current `status`, and the **gap to promote** (which of
`code_ref` / `test_ref` / `doc_ref` is empty), and state in the plan how this work advances that REQ.
If no row matches, the issue is out of product-RTM scope — note it and move on.

**At `verification`** — if the work supplied a missing `code_ref` / `test_ref` / `doc_ref`, update that
row (refs + status) and include the matrix change in the **same PR** (atomic code + SSOT). The
FEATURE_MATRIX gate (part of `check-all`) refreshes the counters and validates `status ⟺ refs` — e.g.
`Done` requires all three refs to exist on disk — so a status the refs don't back up fails closed.

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
gh pr create --title "type(#NNN): summary" --body "$(cat <<'PRBODY'
## Summary
<1-3 bullet points of what changed and why>

## Changes
- `file/path.ts`: <what changed>
- `__tests__/...`: <tests added/updated>

## Test plan
- [ ] New tests pass (`npm run test run <path>`)
- [ ] Gate green (`node scripts/check-all.mjs L1`)
- [ ] Acceptance criteria verified (list each criterion: PASS/FAIL)

Closes #NNN
PRBODY
)"
gh pr checks --watch
gh pr merge --rebase --admin
```


---

## Complete

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
  plan-review `latest.json` (written by the plan-review dispatch — not a CLI command since #1817),
  `.arbiter/agents-dispatched.json`
  (written in the refactor section above), `.arbiter/gate-pass.json` (written by the gate). The
  `phase: complete` state releases the guard.
- Never skip the gate, never commit to `main` outside the merge step, never leave the loop mid-phase
  without an `arbiter mark` cursor.
