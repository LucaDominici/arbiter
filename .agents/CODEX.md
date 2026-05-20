---
title: 'arbiter — Codex Configuration'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# arbiter — Codex Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds OpenAI Codex-specific configuration only.

---

## Quick Reference

| Fact                | Value                        |
| ------------------- | ---------------------------- |
| **Project**         | arbiter                      |
| **Test**            | `npm run test`               |
| **Gate**            | `node scripts/check-all.mjs` |
| **Full governance** | `../AGENTS.md`               |

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
  "invariants": ["INV-01", "INV-22"],
  "gate": "node scripts/check-all.mjs L2"
}
```

## Task Workflow

Follow this lifecycle for every task:

1. **Start**: Read GitHub issue → read `AGENTS.md` → create `task/#NNN-description` branch
2. **Plan**: Create `.agents/plan/PLAN.json` with file manifest and invariants
3. **Implement**: Write tests first, then implementation. Run `npm run test` after each unit
4. **Gate**: `node scripts/check-all.mjs L1` before commit, `node scripts/check-all.mjs L2` before push
5. **Finalize**: Commit → push → PR → verify CI → merge

## Command Translation

| Claude Code                     | Codex Equivalent                                      |
| ------------------------------- | ----------------------------------------------------- |
| `/task #NNN`                    | Full lifecycle: branch → plan → implement → gate → PR |
| `npm run test`                  | Run tests for this stack                              |
| `node scripts/check-all.mjs L1` | Run before each commit                                |
| `node scripts/check-all.mjs L2` | Run before push/PR                                    |

## Hard Stops

All hard stops from `AGENTS.md` apply. Additionally:

- Never edit without a plan in `.agents/plan/PLAN.json`
- Never commit directly to `main`
- Never skip the gate

---

## Known Limitations — Codex Governance Parity

Codex does not have a hook system. The following enforcement mechanisms exist in
Claude Code but have **no real-time Codex equivalent**. Gate-time enforcement
(`node scripts/check-all.mjs`) covers most of these at L1/L2.

| Claude Code Hook             | What it enforces                           | Codex equivalent                  |
| ---------------------------- | ------------------------------------------ | --------------------------------- |
| `check-no-any.mjs`           | Blocks TypeScript `any` types (INV-04)     | Gate: `tsc --strict`              |
| `check-no-orphan-todo.mjs`   | Blocks bare TODO without task ID (INV-06)  | Gate: `check-all.mjs` grep step   |
| `check-no-pii.mjs`           | Blocks PII patterns in source (real-time)  | Gate: `scripts/pii-scan.mjs`      |
| `pre-edit-ssot-guard.mjs`    | Warns on SSOT/governance file edits        | None — manual discipline          |
| `pre-edit-plan-anchor.mjs`   | Requires plan file in implementation phase | `.agents/plan/PLAN.json` protocol |
| `debug-state-on-failure.mjs` | Persists debug state on gate failure       | None — manual logging             |
| `skill-forced-eval.mjs`      | Forces skill invocation before task start  | None — manual discipline          |
| `post-edit-dispatch.mjs`     | Runs post-edit agents for quality checks   | None — manual code review         |
| `guard-task-completion.mjs`  | Blocks premature done claims               | None — manual discipline          |
| `check-circular-deps.mjs`    | Detects circular deps per-edit (INV-01)    | Gate: `madge --circular src`      |

**Decision:** This gap is intentional. OpenAI Codex has no plugin/hook extension
point at the time of writing. When Codex adds a hook system, `codex-adapter.mjs`
should be extended to bridge these checks. Gate-level enforcement catches all
critical violations before merge.
