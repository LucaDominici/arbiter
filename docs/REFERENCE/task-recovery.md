# Task Recovery Reference

**Issue:** #690  
**Command:** `arbiter task resume`

Use this when a session interrupted mid-task and you need to know where to pick up.

---

## Quick Command

```bash
arbiter task resume
```

Reads `.claude/.task-phase` (and `.claude/.task-id` if present) and prints the recovery action for the current phase.

---

## Phase Recovery Table

| Phase             | What Happened           | Recovery Action                                                                                                                          |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`       | Task not started        | Run `/task #NNN` to initialize branch and plan                                                                                           |
| `plan`            | Plan being written      | Check `.claude/plans/` for draft — await user GO                                                                                         |
| `red-team-review` | Red-team agents running | Review `.arbiter/evidence/redteam/<task-id>.json`; CRITICAL → `arbiter task advance --to red-team-rework`; clear → `--to implementation` |
| `red-team-rework` | Critical findings       | Fix plan; re-run red-team: `arbiter task advance --to red-team-review`; or full replan: `--to plan`                                      |
| `implementation`  | Coding in progress      | Check `git status` + `.claude/.task-plan`; resume TDD cycle; run `node scripts/check-all.mjs L1`                                         |
| `verification`    | Gate running            | Re-run `node scripts/check-all.mjs L2`; fix failures; commit and push                                                                    |
| `complete`        | Task done               | Verify PR created: `gh pr list --head $(git branch --show-current)`; confirm issue closed                                                |

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
