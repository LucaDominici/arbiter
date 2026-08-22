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



| Phase | What `/ship` does | Review agents |
|-------|-------------------|---------------|
| `preflight` | Open worktree (`/wt-open #NNN`), read issue, **readiness gate (INV-138)**: `gh issue view NNN --json body -q .body > /tmp/issue-NNN.md && [ -f scripts/issue-readiness.mjs ] && node scripts/issue-readiness.mjs --body-file /tmp/issue-NNN.md --emit-comment` — exit 1 ⇒ label `needs-clarification`, post the emitted comment (skip when already labeled), STOP the ship. The `[ -f … ]` guard makes the step a no-op on brownfield trees that predate the script's emission (ADR-110) — a missing script is never a not-ready verdict; seed task state (see Local-only state above) | — |
| `plan` | Write the plan; **freeze the issue's `AC-N:` criteria verbatim into `## Acceptance Criteria` + `## Non-Goals` (INV-138 anchor — the DoD derives from the issue, not from your interpretation)**; pass the plan-review gate (dispatch review agents, write `.arbiter/evidence/plan-review/<id>/latest.json` with verdict `PASS`); the plan MUST carry the mandatory sections (see §Plan contents) | — |
| `red-team-review` | Dispatch tier-N red-team agents; route CRITICAL → `red-team-rework` | tier-N |
| `red` | Write failing tests (TDD red) — test titles cite the anchor ids (`it('… (AC-2)')`); the red commit body carries "tests map 1:1 to the acceptance criteria of #NNN"; `arbiter task record-red` | — |
| `green` | Implement the minimum to pass (composes with active companion plugins — see below) | — |
| `refactor` | Clean up; dispatch 2 code-review agents + 1 adversarial verifier | 2 (Standard) |
| `verification` | Run the gate: `pytest` then `node scripts/check-all.mjs check` | — |
| `complete` | Commit, push, open/merge PR, close issue, clean up | — |


Review-agent minimums by tier: XS=1, S=1, Standard=2.


---

## Merge Contract (derive before writing — INV-138)

Before the first edit of each slice, derive its **merge contract** and record it in the
plan; code and tests are born against the contract, never against a re-reading of the
issue. Six sources:

1. **Acceptance criteria** — the frozen `AC-N` anchor (the DoD core, hard-gated by
   `check-acceptance`).
2. **Repo policy** — invariants/CANON in scope (cite `INV-NN` ids).
3. **Required tests** — the TDD units proving each `AC-N`, named up front.
4. **CI** — which gate checks/lanes the slice must keep green (L1/L2, workflows).
5. **Review/security** — the review verticals and security surfaces the diff will face.
6. **Dependencies** — modules/contracts the slice touches (blast radius via `/impact`).

Adversarial review runs against this contract **before push**. Pricing the constraint set
in before the first line is what kills accordion PRs (write → review reveals a missed
constraint → rewrite → repeat).

---

## Plan contents (mandatory sections)

/ship plans with a SINGLE planner; these mandatory sections make that one plan carry what a multi-specialist panel would have produced (#2176 study: union-of-specialists prompt reproduced 3-specialist content at +19% cost vs +69% for real orchestration, equal quality — multi-specialist planning is NOT adopted).

- **Approach & decomposition** — module boundaries and data flow of the change.
- **Threat model & abuse cases** — who can abuse this and how. May be `n/a — no security surface` ONLY with a one-line justification; a bare `n/a` is a plan-review FAIL.
- **Input validation** — what is validated, where the trust boundary is, what happens on invalid input.
- **Idiomatic patterns & pitfalls** — the recommended stdlib/framework APIs for this change and the known traps to avoid.
- **Acceptance criteria (merged)** — the frozen `AC-N` anchor VERBATIM, extended with security ACs and edge cases that continue the same numeric `AC-N` series (the anchor parser only accepts numeric ids like `AC-4`; hand-invented ids such as `AC-S1` fail the gate); extend the existing `## Acceptance Criteria` anchor, never a rival heading.
- **Test strategy** — which TDD units prove which AC, and at which level (unit/integration/gate).
- **Risks** — what can go wrong, with the mitigation or the accepted residual.

Never one-shot it — draft, then revise once before finalizing: the revise pass was part of the measured treatment, not optional polish.

These sections EXPAND the Merge Contract's six sources (merged ACs ⊃ source 1, test strategy ⊃ source 3, threat model ⊃ source 5, decomposition ⊃ source 6) — derive the contract once, express it here.

Plan-review agents verify every mandatory section is present and non-empty; a missing or empty section is a FAIL verdict in `.arbiter/evidence/plan-review/<id>/latest.json`. No separate gate script exists for this — the reviewers are the check.

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
- `pytest run <path>` for added or changed tests,
- a formatter `--check` on just the edited files.

Resolve everything in one work session, then let the `verification` phase run the full gate
once. This is a **speed** optimization, not a gate skip — the full gate still runs before
commit (L1) and before push (L2).

---

## Red-team review



---

## Refactor / code-review evidence



---

## Merge step




**peer-review / gated-review:** open a PR and merge without rewriting its commits:


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
gh pr merge --merge --admin

```


---

## Complete

Close the issue:


Mark the work item done manually (no CLI command for the `markdown` backend — the `work` command was
removed in #1817; track closure in your issue tracker of choice).


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
