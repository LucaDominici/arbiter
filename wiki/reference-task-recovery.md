---
generated: true
source: 'docs/REFERENCE/task-recovery.md'
source_sha: '7e5bdfd7d91f87e93ae7957be86aee1ab2d63b0a'
last_updated: '2026-06-07'
---

# Task Recovery Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/task-recovery.md](../docs/REFERENCE/task-recovery.md)

# Task Recovery Reference

**Issues:** #690, #694, #1206
**Commands:** `arbiter task resume`, `arbiter mark`, `arbiter task recover`, `arbiter ship`

Use this when a session interrupted mid-task and you need to know where to pick up.

---

## Quick Command

```bash
arbiter task resume
```

Reads the unified task document (`.claude/.task/status.json`, see below) and prints where to resume.
If a step-cursor was set with `arbiter mark`, resume lands on the **exact** next action; otherwise it
falls back to phase-level recovery guidance.

---

## Pinpoint resume — `arbiter mark` (#1206)

`arbiter task resume` is phase-granular by default. For an interrupted session to resume at the EXACT
sub-step (not "you were somewhere in green"), drop a step-cursor as you work:

```bash
arbiter mark --tdd GREEN \
  --last "wrote failing test for validateEmail" \
  --next "implement validateEmail in src/validators.ts" \
  --digest "green: stubbing validateEmail"
```

After a mid-task `/clear`, `arbiter task resume` reads the cursor from disk and prints:

```
Phase: green (GREEN)
Last action: wrote failing test for validateEmail
Next action: implement validateEmail in src/validators.ts
```

The cursor lives in the single unified document, so resume is exact — not inferred from the
filesystem. `--digest` also appends a one-line entry to `.claude/.task/log.md`.

---

## Orchestrated runs — `/ship` (orchestration entrypoint, #1216)

`/ship #NNN` (Claude Code) / `arbiter ship <id>` (CLI) is the **single orchestration entrypoint** —
it drives an issue to a reviewed, merged PR by auto-sequencing
(worktree → plan → red-team → TDD impl → review → gate → merge → cleanup).
Use `/task` subcommands (`arbiter task advance`, `record-red`, etc.) only for recovery or manual
phase control; the `/ship` loop auto-advances phases when their gates are green.

---

## Context-Rot 3-Layer Recovery (#694)

When a session is auto-compacted or `/clear`-ed mid-task and `arbiter task resume` is not enough:

```bash
arbiter task recover               # uses .claude/.task-id
arbiter task recover --task #694   # explicit id
```

Output assembles three layers of recovery context:

| Layer | Source                                                          | What it gives you                                          |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | `.arbiter/evidence/<sanitized-task-id>/BACKLOG.md` (if present) | Free-form notes the previous session pinned for itself     |
| 2     | `git log -F --grep 'CHECKPOINT(#<id>)'` (last 10)               | Commits explicitly tagged as recovery checkpoints          |
| 3     | `git log` (last 20 commits)                                     | Fallback context — what was happening in the repo recently |

The footer always prints the MCP manual-recovery instruction in case the three layers aren't enough.

### BACKLOG.md authoring

Drop a markdown file with whatever the next session needs to know:

```bash
mkdir -p .arbiter/evidence/_694
cat > .arbiter/evidence/_694/BACKLOG.md <<'EOF'
# Backlog for #694

## What's done
- Layer-1 scaffolding shipped

## What's next
- Wire CLI subcommand
- Update task-recovery.md
EOF
```

Task ids are sanitized to `[a-zA-Z0-9_-]` (cap 64 chars) — `#694` becomes `_694`. The `.arbiter/` directory is gitignored, so the backlog stays local.

### CHECKPOINT commit convention

Tag any commit you want surfaced by Layer 2:

```bash
git commit -m "CHECKPOINT(#694): refactor dispatch.ts before context window fills"
```

---

## Phase Recovery Table

| Phase                        | What Happened                                         | Recovery Action                                                                                                                        |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`                  | Task not started                                      | Run `/task #NNN` to initialize branch and plan                                                                                         |
| `plan`                       | Plan being written                                    | Check `.claude/plans/` for draft — await user GO                                                                                       |
| `red-team-review`            | Red-team agents running                               | Review `.arbiter/evidence/redteam/<task-id>.json`; CRITICAL → `arbiter task advance --to red-team-rework`; clear → `--to red`          |
| _(handoff boundary)_         | `planningHandoffReady` set, `postClearResumed` absent | Run `/clear` then `arbiter ship #NNN --advance --post-clear --units <N>`; see `docs/REFERENCE/recipes/cost-optimized-phase-handoff.md` |
| `red-team-rework`            | Critical findings                                     | Fix plan; re-run red-team: `arbiter task advance --to red-team-review`; or full replan: `--to plan`                                    |
| `red` / `green` / `refactor` | TDD cycle in progress                                 | `arbiter task resume` (lands on the cursor if `arbiter mark` was used); run `node scripts/check-all.mjs L1`                            |
| `verification`               | Gate running                                          | Re-run `node scripts/check-all.mjs L2`; fix failures; commit and push                                                                  |
| `complete`                   | Task done                                             | Verify PR created: `gh pr list --head $(git branch --show-current)`; confirm issue closed                                              |

---

## The unified task document (#1206)

All task state lives in **one** authoritative document pair at a fixed path (one active task per
working tree). The legacy split-brain — flat `.claude/.task-*` dotfiles plus a per-id
`.claude/.task-{sanitized}/status.json` — has been collapsed into it. Reading a tree that still has
the legacy files migrates it transparently (seed + delete) on first access.

```
.claude/.task/status.json   structured state — single atomic writer
.claude/.task/log.md         append-only digest (every phase transition + every `arbiter mark`)
```

`status.json` schema:

```json
{
  "taskId": "#NNN",
  "phase": "green",
  "tier": "Standard",
  "plan": ".claude/plans/task-NNN.md",
  "cursor": {
    "tddPhase": "GREEN",
    "lastAction": "wrote failing test for validateEmail",
    "nextAction": "implement validateEmail in src/validators.ts"
  },
  "handoffStrategy": "interactive",
  "handoffReady": true,
  "runId": "12345-1715817000000",
  "timestamps": { "plan": "2026-05-16T00:08:00.000Z", "green": "2026-05-16T00:08:30.000Z" },
  "gateDecisions": []
}
```

| Field    | Description                                                                |
| -------- | -------------------------------------------------------------------------- |
| `taskId` | Active task id (was `.task-id`)                                            |
| `phase`  | Current lifecycle phase — authoritative, single writer (was `.task-phase`) |
| `tier`   | Task tier XS/S/Standard (was `.task-tier`)                                 |
| `plan`   | Repo-relative path to the plan file (was `.task-plan`)                     |

_[content truncated — see source for full text]_
