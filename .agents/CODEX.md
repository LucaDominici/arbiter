# arbiter — Codex Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds OpenAI Codex-specific configuration only.

---

## Quick Reference

| Fact                | Value                    |
| ------------------- | ------------------------ |
| **Project**         | arbiter                  |
| **Gate**            | `./scripts/check-all.sh` |
| **Full governance** | `../AGENTS.md`           |

---

## Startup Protocol (Read First)

1. Read `AGENTS.md` — this contains ALL governance rules and invariants
2. Read `docs/SYSTEM/ARCHITECTURE.md` if it exists
3. Check current branch: must be `task/#NNN-description` (not `main`)
4. If no task branch exists, create one before any edits

## Execution Model

Codex operates via explicit plans. Before any implementation:

1. Create a plan in `.agents/plan/PLAN.json`
2. List all files to modify with their operations
3. Identify invariants that apply
4. Await GO from the user

## Plan Schema

```json
{
  "run_id": "task-YYYYMMDD-HHMMSS",
  "task_id": "#NNN",
  "scope": {
    "track": "A|B|C",
    "paths": ["list of files to change"]
  },
  "files": [
    {
      "path": "relative/path/to/file",
      "operation": "modify|create|delete",
      "reason": "why this file changes"
    }
  ],
  "invariants": ["INV-01", "INV-07"],
  "gate": "./scripts/check-all.sh L2"
}
```

## Command Translation

| Claude Code                 | Codex Equivalent                    |
| --------------------------- | ----------------------------------- |
| `/start-task #NNN`          | Read issue → create plan → await GO |
| `/complete-task`            | Gate L2 → commit → push → PR        |
| `./scripts/check-all.sh L1` | Run before each commit              |
| `./scripts/check-all.sh L2` | Run before push/PR                  |

## Hard Stops

All hard stops from `AGENTS.md` apply. Additionally:

- Never edit without a plan in `.agents/plan/PLAN.json`
- Never commit directly to `main`
- Never skip the gate
