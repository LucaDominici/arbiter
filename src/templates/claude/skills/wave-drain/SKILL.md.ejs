---
name: wave-drain
description: Use when draining the open backlog at maximum throughput. Batch up to ~10 workable issues into a WAVE, plan and review the wave once cumulatively, dispatch parallel TDD agents in isolated worktrees, then integrate into a SINGLE wave PR merged GREEN. Issues that cannot proceed become needs-human with a blocker report. The orchestrator directs parallel agents — it never implements.
argument-hint: '[--wave-size N] [--max-parallel N]'
title: 'Wave Drain'
doc_version: '1.0.0'
status: active
last_review: '2026-06-13'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/orchestration']
related: ['epic-decompose', 'understand-code', 'tdd', 'verification', 'ssot-navigation']
---

# Wave Drain

**Goal:** Drain the open backlog at maximum throughput. Every workable issue ends either
**merged** (inside a wave PR merged GREEN) or **needs-human** with a blocker report.

**Mental model:** You are the Claude Code **orchestrator**. You do **not** implement — you
**direct parallel agents**. Tokens are saved by running the heavy ceremony **once per wave**
(one cumulative plan, one plan review, one code review, one full gate, one PR), never by
skipping phases.

> `/ship` drives **one issue → one PR**. Wave Drain is its multi-issue sibling: **N issues →
> one wave PR**, reusing the same engine and the same gates.

## Primitives

| Primitive                                                  | Role here                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/ship`                                                    | Pipeline reference for the per-issue phase contract (plan → red-team → TDD → review → verify → merge) |
| `arbiter task init / advance / record-red / recover / get` | The state engine each agent anchors its work to                                                       |
| `/wt-open`, `/wt-close`, `/wt-prune`, `/wt-list`           | Isolated git worktrees, one per group                                                                 |
| Skill `epic-decompose`                                     | Only if an entangled issue must be split before batching                                              |
| Skill `understand-code`                                    | Per-agent code comprehension before editing                                                           |
| Skill `tdd`                                                | The red → green → refactor loop every agent runs per unit                                             |
| Skill `verification`                                       | Claim-based verification on the cumulative branch before the gate                                     |
| Skill `ssot-navigation`                                    | Locate invariants / SSOT before touching guarded files                                                |

---

## Phase 0 — Triage + Wave composition

1. `gh issue list --state open` (this repo). **Exclude** anything labelled `blocked`,
   `needs-human`, or `epic`.
2. Compose a **WAVE**: up to **10 issues**, partitioned into **groups** of **≤5 issues** each,
   grouped by module / dependency. Independent groups are parallelizable. Entangled issues
   (the `/ship` affinity / batching warning flags these) go in the **same group** or get
   **split** first via `epic-decompose`.
3. Record the wave roster: for each group list its issues, target modules, and the
   conflict-risk ordering you will use at integration.

A group is the unit of parallelism. Keep groups module-coherent so two agents never edit the
same file concurrently (see `.claude/rules/50-batch-execution.md`).

### Transactional claim (#1378)

**Check-ALL-then-claim-ALL** to avoid race conditions when multiple drain runs overlap:

```bash
# 1. Verify ALL selected issues are still open and unassigned
for issue in $WAVE_ISSUES; do
  state=$(gh issue view "$issue" --json state,assignees --jq '{state:.state,assignees:(.assignees|length)}')
  echo "$state" | jq -e '.state == "OPEN" and .assignees == 0' > /dev/null || { echo "Issue #$issue not claimable"; exit 1; }
done

# 2. Claim ALL atomically
claimed=()
for issue in $WAVE_ISSUES; do
  if gh issue edit "$issue" --assignees @me; then
    claimed+=("$issue")
  else
    for c in "${claimed[@]}"; do gh issue edit "$c" --remove-assignee @me; done
    echo "Claim failed for #$issue — rolled back all assignments"; exit 1
  fi
done
```

**Rules:**

- Never claim before verifying. A closed or already-assigned issue must be excluded.
- Never swallow `gh issue edit` errors — propagate them and trigger rollback.
- On partial failure, release all already-claimed issues before aborting.
- If rollback itself fails, log the orphaned claims explicitly for manual cleanup.

---

## Phase 1 — One cumulative plan (Opus)

Write **a single cumulative plan** for the whole wave to `.claude/plans/wave-N.md`. For each
group include a **manifest**:

- **Files** the group will touch
- **Invariants** in scope (from `GLOBAL_INVARIANTS.md` + `AGENTS.md` — cite INV-IDs)
- **TDD units** (the red → green slices)
- **Conflict risks** vs other groups (which files / interfaces overlap)

Every implementation agent will **anchor its `arbiter task` to its group's section** of this
plan (CANON-16, enforced by the `pre-edit-plan-anchor` hook). No per-issue plans.

---

## Phase 2 — One plan review

Run the plan gate **once** on the cumulative plan:

```bash
arbiter review plan          # plan-review gate on .claude/plans/wave-N.md
```

In parallel, dispatch a **tier-Standard red-team** (3 agents) against the cumulative plan.

- **CRITICAL** → rework the plan (**max 2 cycles**, then escalate to a human).
- **PASS** = **GO for the entire wave**.

---

## Phase 3 — Parallel execution (scale out)

Spawn **one agent per group** in an **isolated worktree** (`/wt-open`, a branch per group),
**4–6 agents in parallel**.

**Worktree discipline (speed):** inside a worktree run **only light checks** — targeted
`vitest` + the lint from `post-edit-dispatch`. The **full gate is forbidden in worktrees**; it
runs **once**, on integration.

Each agent's loop:

```bash
arbiter task init --plan <wave-N.md#group-anchor>   # anchor to the group's plan section
# TDD per unit (skill: tdd): red → green → refactor
# targeted tests green
git commit                                          # format enforced by post-commit-check
```

Then emit a **DONE report**: files touched, tests added, findings with `auditorHint`
(the `auditor-routing.json` auditor whose remit covers each finding).

**A blocked agent → mark its issue `needs-human` and STOP that agent. It does NOT block the
wave.** The rest of the wave proceeds.

---

## Phase 4 — Local integration (one PR per wave)

1. Create a local integration branch `wave-N-integration` **from `main`** (never commit to
   `main`).
2. **Merge the DONE worktrees sequentially**, in the conflict-risk order from the plan.
   Conflicts → hand to a dedicated conflict agent with the relevant DONE reports.
3. **On the cumulative branch, once only — multiagent code review:**
   - Route auditors: `node scripts/route-auditors.mjs --size-floor Standard`
   - Self-review pass + **Adversarial Verifier**: trace each feature end-to-end, hunt dead
     code and unwired options.
   - Write the **evidence file** (fail-closed, INV-114).
   - Any still-unresolved `redTeamFindings` cap their mapped auditor's score (`[RT-xx UNRESOLVED]`).
   - **CRITICAL / MAJOR** → dispatch a fixer agent.
4. **Verify, then gate:**

   ```bash
   # skill: verification — claim-based pass on the cumulative branch first
   npm run test && node scripts/check-all.mjs check     # FULL GATE → writes gate-pass.json
   ```

   `gate-pass.json` is required by the `enforce-gate-before-pr` hook.

5. **RED → root-cause structural fix** (never `--no-verify`, never skip). If the culprit is
   one group, **revert that group's merge** → mark its issues `needs-human` → the wave
   continues with the rest.
6. **One PR per wave.** Body: a table mapping each issue → its commit, and a `Closes #N1,
#N2, …` line. Merge **only with checks GREEN**:

   ```bash
   gh pr create --title "wave(N): <summary>" --body "<issue→commit table>\n\nCloses #N1, #N2, ..."
   gh pr checks --watch
   gh pr merge --merge        # only when CI is GREEN
   ```

   CI red → root-cause fix → re-gate (PRs are owned until merged green).

7. `/wt-close` (harvest) + `/wt-prune` → `/clear` → **next wave**, until the backlog is empty.

---

## Iron Law

- **No group enters integration** without TDD + targeted tests **green**.
- **Nothing reaches `main`** without: red-team on the plan, multiagent review + adversarial
  verify, and a **full gate GREEN** on the wave PR.
- The ceremony is **per-wave, not per-issue** — that is where the tokens are saved, **not by
  skipping it**.

## Stop conditions (fail-closed)

STOP, write a blocker report, mark the issue `needs-human`, and **move on** when you hit:

- An invariant violation → **cite the INV-ID**.
- An unauthorized edit to an SSOT or read-only file.
- An orphan TODO (no task ID).
- An `any` type / placeholder left in edited code.
- **2 failed plan-review cycles.**

A stop never halts the whole wave — it removes one group/issue and the wave proceeds.

## Completion

Done **only when the backlog is empty** — every issue is either **merged** or **needs-human
with a stated reason**. Emit a final report: **issue → outcome + PR**.
