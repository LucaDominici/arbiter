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

## Train

A **train** is one worktree, one branch, one plan, one gate and one PR carrying N issues. It is
the **DEFAULT unit of ceremony** for every issue that does not widen the tier to Standard (the
XS/S band, size ≤ M). Ten three-line fixes pass ONE ceremony, not ten.

```bash
arbiter ship #A #B #C          # declare a train — sugar for `#A --chain #B --chain #C`
arbiter ship --chain-add #D    # grow it, or be refused and told to land it first
arbiter ship --seal            # close it now; the next issue starts a new train
```

| Runs ONCE per train                 | Runs per issue                          |
| ----------------------------------- | --------------------------------------- |
| plan (one cumulative plan)          | its `AC-<issue>.<n>` anchor lines       |
| plan-review                         | its TDD evidence file                   |
| red-team                            | its `Closes #N` line in the PR body     |
| code review + adversarial verify    |                                         |
| review rounds (`ship.review.maxRounds`) |                                     |
| cross-model review seat             |                                         |
| full gate                           |                                         |
| PR (`Closes #A`, `Closes #B`, …)    |                                         |

**One plan, one anchor.** The train's plan carries a SINGLE `## Acceptance Criteria` section
listing every member's criteria, namespaced per issue as `AC-<issue>.<n>` (`AC-2401.1`,
`AC-2402.1`, …). The anchor parser accepts that dotted numeric form, and `check-acceptance`
rejects duplicate ids — which is exactly what an un-namespaced multi-issue plan produces. Every
other mandatory section (see §Plan contents) is written once, for the train.

**Tier = widest member.** Compute each member's tier as usual and take the widest; the
widen-only rule above applies unchanged (signals may widen, never narrow). An issue that widens
the train to Standard does not join it — a risk-bearing issue rides its own train.

**Stop rules** — the train seals, and the next issue starts a new one, on any of: an explicit
`--seal`, a member that widens the tier to Standard, `maxChain` ids already on the branch, or
`maxAgeMinutes` elapsed since the train opened. Both bounds come from `ship.train` in
`arbiter.json` (defaults: 10 issues, 480 minutes); `ship.review.maxRounds` bounds review rework
the same way (default 2). A refused `--chain-add` is the policy working — land the train.

**Gate cadence.** Targeted tests during `green` / `refactor`, `node scripts/check-all.mjs L1`
once at the landing commit, `L2` once at push — see §Gate economy, which governs a train exactly
as it governs a single issue. Gates are per LANDING, ceremony is per TRAIN; neither is per issue.

**Running the full per-issue ceremony over a batch of small issues is a playbook violation, not
extra safety.** It buys no additional signal — the same plan reviewer, the same red-team, the
same reviewer panel read the same kind of diff N times — and it spends the budget on the part of
the work that was already cheap instead of on the residual 10% (merge, red gate, conflict) that
is not.

---

## Local-only state

Before writing task state, ensure runtime files never get committed:

```bash
exclude_file="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude_file")" .claude/plans
touch "$exclude_file"
node -e 'const fs=require("node:fs"),p=process.argv[1],s=fs.readFileSync(p,"utf8"),n=s.replace(/^\.arbiter\/\r?$(?:\n)?/gm,"");if(n!==s)fs.writeFileSync(p,n)' "$exclude_file"
for pattern in ".claude/.task-*" ".claude/.task/" ".claude/plans/" ".agents-dispatched"; do
  grep -qxF "$pattern" "$exclude_file" || printf "%s\n" "$pattern" >> "$exclude_file"
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
| `preflight` | Open worktree (`/wt-open #NNN`), read issue, **readiness gate (INV-138)**: `gh issue view NNN --json body -q .body > /tmp/issue-NNN.md && [ -f scripts/issue-readiness.mjs ] && node scripts/issue-readiness.mjs --body-file /tmp/issue-NNN.md --emit-comment` — exit 1 ⇒ label `needs-clarification`, post the emitted comment (skip when already labeled), stop the ship. When the script is absent (brownfield trees predating its emission, ADR-110) a missing script is never a not-ready verdict — but the skip is declared, never silent: record `readiness: script absent — skipped` in the plan preamble so the omission stays visible. Seed task state (see Local-only state above) | — |
| `plan` | Write the plan; **freeze the issue's `AC-N:` criteria verbatim into `## Acceptance Criteria` + `## Non-Goals` (INV-138 anchor — the DoD derives from the issue, not from your interpretation)**; run the `senior-survey` skill for every new `src/` file the plan introduces (the pre-edit hook validates its Survey block); pass the plan-review gate (dispatch review agents, write `.arbiter/evidence/plan-review/<id>/latest.json` with verdict `PASS`); the plan carries every mandatory section (see §Plan contents) — a missing section is a FAIL | — |
| `red-team-review` | Dispatch tier-N red-team agents; route CRITICAL → `red-team-rework` | tier-N |
| `red` | Write failing tests with the `tdd` skill (red → verify-red is its own step: watch each test fail for the right reason) — test titles cite the anchor ids (`it('… (AC-2)')`); the red commit body carries "tests map 1:1 to the acceptance criteria of #NNN"; `arbiter task record-red` | — |
| `green` | Implement the minimum to pass, continuing the `tdd` loop (composes with active companion plugins — see below) | — |
| `refactor` | Clean up; dispatch 2 code-review agents + 1 adversarial verifier | 2 (Standard) |
| `verification` | Run the `verification` skill, then the gate: `pytest` then `node scripts/check-all.mjs check` | — |
| `complete` | Commit, push, open/merge PR, close issue, clean up | — |

### Model tier per dispatch (static guidance, AGENTS.md §Model-Pyramid)

Mechanical sub-steps — readiness parsing, auditor routing, file discovery, grep sweeps — go
to the cheapest agent (`codebase-scanner`, Haiku). Review, context-check and gate-bridge
subagents run on Sonnet-class agents (their registry defaults). The session model
(Opus/Fable-class) is reserved for the judgment stages: plan synthesis, red-team attack
angles, and the adversarial verifier's verdict. This is dispatch guidance the orchestrator
applies when spawning agents, not runtime machinery — arbiter never selects a model tier
programmatically.


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
- **Threat model & abuse cases** — who can abuse this and how. `n/a — no security surface` is accepted only with a one-line justification; a bare `n/a` is a plan-review FAIL.
- **Input validation** — what is validated, where the trust boundary is, what happens on invalid input.
- **Idiomatic patterns & pitfalls** — the recommended stdlib/framework APIs for this change and the known traps to avoid.
- **Acceptance criteria (merged)** — the frozen `AC-N` anchor VERBATIM, extended with security ACs and edge cases that continue the same numeric `AC-N` series (the anchor parser only accepts numeric ids like `AC-4` — or the dotted per-issue `AC-<issue>.<n>` form a train plan uses, see §Train; hand-invented ids such as `AC-S1` fail the gate); extend the existing `## Acceptance Criteria` anchor, never a rival heading.
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

Optional, at `verification` and before release-class changes: run `/tabletop <scenario>` to
walk one user journey end to end and record where the docs and the behaviour disagree
(`docs/internal/METHOD/TABLETOP-SCENARIOS.md`). It is evidence-only and never edits the tree;
blockers are hard stops — ship nothing until each one is fixed or filed with an owner.

---

## Red-team review



---

## Refactor / code-review evidence

**Review rounds are bounded.** Entering `refactor` opens round 1; each review dispatched after a
FIX is `arbiter ship --review-round`, which counts. A completion-gate retry does not: re-dispatching
a reviewer that returned no envelope re-reads the same diff, so it is the same round. Round N ≥ 2
reviews the DELTA only — `git diff <lastReviewedSha>..HEAD`, printed as the step's `Review scope:`
line — never the whole change again: re-reading a growing diff always finds something new, which is
how a review loop burns a day without converging. Reviewer findings **below HIGH do not block
landing** — park them (`arbiter note` each, then ONE follow-up issue) and land; that threshold is
about REVIEWER findings, while the ac-fit verdicts below are a separate hard gate still requiring
all-PASS. The cap is `ship.review.maxRounds` in `arbiter.json` (default 2): the round past it is
refused naming both exits, and `arbiter ship --review-round --force-review` takes it deliberately
and records `forced`. Rounds are counted per train, like every other ceremony.



---

## Merge step




**peer-review / gated-review:** open a PR and merge without rewriting its commits.

> **This arc does NOT land the exact gated SHA.** The GitHub merge gives `main` a new
> tip, so here `main != gatedHeadSha` — the exact-SHA guarantee of `trunk-solo + pr-ff`
> does not carry over. Landing the gated head itself needs a trusted updater (a GitHub
> App authorised to advance the ref), tracked on #2289. Until it exists this is the only
> landing path available in these modes, and `scripts/pr-merge-watch.mjs` refuses them
> outright rather than pretending otherwise.


```bash
gh pr create --title "type(#NNN): summary" --body "$(cat <<'PRBODY'
## Summary
<1-3 bullet points of what changed and why>

## Changes
- `file/path.ts`: <what changed>
- `__tests__/...`: <tests added/updated>

## Test plan
- [ ] New tests pass (`pytest run <path>`)
- [ ] Gate green (`node scripts/check-all.mjs L1`)
- [ ] Acceptance criteria verified (list each criterion: PASS/FAIL)

Closes #NNN
PRBODY
)"

gh pr checks --watch
gh pr merge --merge

```


---

## Complete

Close the issue:


Mark the work item done manually (no CLI command for the `markdown` backend — the `work` command was
removed in #1817; track closure in your issue tracker of choice).


Advance to the terminal phase and close the worktree. `--to complete` now VERIFIES the landing:
it reads the branch's PR (`gh pr list --head <branch> --state all`) and refuses unless it is
MERGED, naming the PR, its state and every check whose conclusion is FAILURE / TIMED_OUT /
CANCELLED. A repo that lands by direct push passes `--no-pr` (logged as
`complete ← no-pr (direct landing)`); `--pr <n>` names the PR when the branch carries more than
one. An unreadable `gh` refuses too — an unverifiable landing is not a landing.

```bash
arbiter task advance --to complete
arbiter wt close NNN
```

### Handover

A session may end in exactly two states: the PR is **merged**, or the PR is labeled
`needs-human` and the handover names the failing check. There is no third state — an open PR
with red CI that nobody owns is the failure this rule exists to prevent.

The handover file is `.arbiter/HANDOVER-<date>-<slug>.md` and its FIRST section is the open-PR
table, so whoever picks it up sees the debt before the narrative:

```markdown
## Open PRs

| PR   | Branch                  | CI state         | Blocker                          |
| ---- | ----------------------- | ---------------- | -------------------------------- |
| #123 | task/#120-thing         | red (Docs Build) | needs-human: link check 404s     |
| #124 | task/#121-other         | green, unmerged  | awaiting required review         |
```

Every red row carries the check name and the `gh run view --job <id> --log` the watcher printed.
A row with no blocker text is an unfinished handover, not a finished one.

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
- If `tasks.worktree` is `always` in `arbiter.json`, open a worktree before any edit — a ship
  that skipped it stops here, because every downstream artifact (branch, evidence, gate) is
  anchored to the worktree.
- The fail-closed Stop hook (INV-114) requires three correlated artifacts before any completion claim:
  plan-review `latest.json` (written by the plan-review dispatch — not a CLI command since #1817),
  `.arbiter/agents-dispatched.json`
  (written in the refactor section above), `.arbiter/gate-pass.json` (written by the gate). The
  `phase: complete` state releases the guard. Review evidence binds to SOURCE CONTENT, not to an
  exact HEAD: an evidence-only commit keeps it valid, a source change invalidates it, and a sidecar
  whose `taskId` is another task counts as absent — record this task's own before claiming.
- An open PR with red CI is never abandoned — watch, fix, re-watch. Ending a session on one is
  allowed only with the PR labeled `needs-human` and the failing check named in the handover.
- Never skip the gate, never commit to `main` outside the merge step, never leave the loop mid-phase
  without an `arbiter mark` cursor.
