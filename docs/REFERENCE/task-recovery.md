---
title: 'Task Recovery Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Task Recovery Reference

**Issues:** #690, #694
**Commands:** `arbiter task resume`, `arbiter task recover`

Use this when a session interrupted mid-task and you need to know where to pick up.

---

## Quick Command

```bash
arbiter task resume
```

Reads `.claude/.task-phase` (and `.claude/.task-id` if present) and prints the recovery action for the current phase.

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

| Phase                | What Happened                                         | Recovery Action                                                                                                                          |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`          | Task not started                                      | Run `/task #NNN` to initialize branch and plan                                                                                           |
| `plan`               | Plan being written                                    | Check `.claude/plans/` for draft — await user GO                                                                                         |
| `red-team-review`    | Red-team agents running                               | Review `.arbiter/evidence/redteam/<task-id>.json`; CRITICAL → `arbiter task advance --to red-team-rework`; clear → `--to implementation` |
| _(handoff boundary)_ | `planningHandoffReady` set, `postClearResumed` absent | Run `/clear` then `arbiter task advance --post-clear --to red`; see `docs/RECIPES/cost-optimized-phase-handoff.md`                       |
| `red-team-rework`    | Critical findings                                     | Fix plan; re-run red-team: `arbiter task advance --to red-team-review`; or full replan: `--to plan`                                      |
| `implementation`     | Coding in progress                                    | Check `git status` + `.claude/.task-plan`; resume TDD cycle; run `node scripts/check-all.mjs L1`                                         |
| `verification`       | Gate running                                          | Re-run `node scripts/check-all.mjs L2`; fix failures; commit and push                                                                    |
| `complete`           | Task done                                             | Verify PR created: `gh pr list --head $(git branch --show-current)`; confirm issue closed                                                |

---

## Status File

The task runner writes `.claude/.task-NNN/status.json` after each phase transition. Schema:

```json
{
  "phase": "implementation",
  "timestamps": {
    "plan": "2026-05-16T00:08:00.000Z",
    "implementation": "2026-05-16T00:08:30.000Z"
  },
  "runId": "12345-1715817000000",
  "gateDecisions": [],
  "task": "#NNN"
}
```

| Field           | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `phase`         | Current lifecycle phase                                             |
| `timestamps`    | ISO timestamps for each phase entered (accumulated across sessions) |
| `runId`         | `<pid>-<epoch-ms>` — unique per process invocation                  |
| `gateDecisions` | Gate pass/fail records (populated by gate runner)                   |
| `task`          | Task ID if provided at write time                                   |
| `branch`        | Git branch name if provided via extras at write time                |

Writes are atomic: `writeTaskStatus` routes through `writeFile` (which calls `atomicWrite`), so the temp file is registered in `inFlightTmpPaths` and cleaned up by SIGTERM/SIGINT handlers (#613). A hex-suffix temp name (`status.json.arbiter-tmp-XXXX`) prevents name collisions under concurrent writes.
