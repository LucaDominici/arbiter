# /replay <phase>

Re-enter a specific task phase's instructions without resetting state.

## What This Does

Load and present the instructions for the named phase from the active task skill. Useful when you need to re-execute a phase (e.g., re-run code review, re-verify gate) without losing current progress.

**Supported phase names:** `plan`, `context`, `classification`, `setup`, `implementation`, `review`, `gate`, `commit`, `pr`, `cleanup`

**Example:**

```
/replay review
```

Re-presents Phase 6 (Code Review) instructions for the active task.

## Steps

1. Read `.claude/.task-id` to confirm active task (e.g., `#191`).

2. Read `.claude/.task-phase` to confirm current phase.

3. Match the argument (e.g., `review`) to the corresponding phase section in `/task`.

4. Present the full phase instructions as if the user had just reached that phase.

5. Do NOT reset state files. Do NOT revert `.task-phase` to an earlier value.

6. If argument is missing or unrecognized, list valid phase names and exit.

## Phase → Section mapping

| Argument       | Phase section in /task  |
| -------------- | ----------------------- |
| plan           | Phase 3: Plan Creation  |
| context        | Phase 1: Context        |
| classification | Phase 2: Classification |
| setup          | Phase 4: Setup          |
| implementation | Phase 5: Implementation |
| review         | Phase 6: Code Review    |
| gate           | Phase 8: Gate           |
| commit         | Phase 9: Commit + Push  |
| pr             | Phase 10: PR + Merge    |
| cleanup        | Phase 11: Cleanup       |

## Allowed Tools

- `Read` for `.claude/.task-id`, `.claude/.task-phase`

## Related Commands

- **Check current status:** `/status` (phase, timestamp, log)
- **Start a task:** `/task #NNN` (full lifecycle)

## Troubleshooting

- **No active task:** no `.claude/.task-id` file; start with `/task #NNN`
- **Phase argument not recognized:** check the Phase → Section mapping table above
