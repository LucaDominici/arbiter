---
title: '/replay <phase>'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /replay <phase>

Re-enter a specific task phase's instructions without resetting state.

## What This Does

Load and present the instructions for the named phase from the active task skill. Useful when you need to re-execute a phase (e.g., re-run code review, re-verify gate) without losing current progress.

**Supported phase names:** `plan`, `red-team`, `red`, `green`, `refactor`, `review`, `gate`, `merge`, `complete`

**Example:**

```
/replay review
```

Re-presents the code-review / Refactor section instructions from `/ship` for the active task.

## Steps

1. Read `.claude/.task/status.json` to confirm active task and current phase.

2. Match the argument (e.g., `review`) to the corresponding section in `/ship`.

3. Present the full phase instructions as if the user had just reached that phase.

4. Do NOT reset state files. Do NOT revert the phase to an earlier value.

5. If argument is missing or unrecognized, list valid phase names and exit.

## Phase → Section mapping

| Argument | Section in /ship                               |
| -------- | ---------------------------------------------- |
| plan     | § Local-only state + § Phase map (plan row)    |
| red-team | § Red-team review                              |
| red      | § Phase map (red row) + TDD evidence recording |
| green    | § Phase map (green row)                        |
| refactor | § Refactor / code-review evidence              |
| review   | § Refactor / code-review evidence              |
| gate     | § Phase map (verification row)                 |
| merge    | § Merge step                                   |
| complete | § Complete                                     |

## Allowed Tools

- `Read` for `.claude/.task-id`, `.claude/.task-phase`

## Related Commands

- **Check current status:** `/status` (phase, timestamp, log)
- **Start a task:** `/task #NNN` (full lifecycle)

## Troubleshooting

- **No active task:** no `.claude/.task-id` file; start with `/task #NNN`
- **Phase argument not recognized:** check the Phase → Section mapping table above
