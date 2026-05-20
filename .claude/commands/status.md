---
title: '/status'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /status

Show the current task status, phase, and recent log entries.

## What This Does

Read the active task's status file and log from `.claude/.task-<NNN>/` to report the current phase and timeline. Useful after a compaction event or when resuming a session.

**Example output:**

```
Task:  #191
Phase: implementation
Since: 2026-05-11T14:30:00Z

Recent log:
  2026-05-11T14:00:00Z  plan
  2026-05-11T14:30:00Z  implementation
```

## Steps

1. Read `.claude/.task-id` to get the task number NNN.

2. Read `.claude/.task-phase` to get the current phase.

3. Read `.claude/.task-<NNN>/status.json` for the structured status.

4. Read `.claude/.task-<NNN>/log.md` for the full phase timeline.

5. Print: task ID, current phase, timestamp, last 5 log lines.

6. If no status files exist, report: "No active task state found. Run `/task #NNN` to start."

## Allowed Tools

- `Read` for `.claude/.task-id`, `.claude/.task-phase`, `.claude/.task-NNN/status.json`, `.claude/.task-NNN/log.md`
- `Bash` for `cat` fallback if Read fails on missing files

## Related Commands

- **Replay a phase:** `/replay <phase>` (re-enter phase instructions)
- **List worktrees:** `/wt-list` (show open worktrees)
- **Start a task:** `/task #NNN` (full lifecycle)

## Troubleshooting

- **No task-id file:** no active task; start one with `/task #NNN`
- **Status shows wrong phase:** state file may be stale; check `.claude/.task-phase` directly
- **Log missing:** task started before #197 was implemented; phase transitions won't be recorded
