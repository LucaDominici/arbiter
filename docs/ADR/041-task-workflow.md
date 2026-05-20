---
title: 'ADR-001: Task Workflow via /task Slash Command'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-001: Task Workflow via /task Slash Command

**Project:** arbiter
**Date:** 2025-01-01
**Status:** Accepted

## Context

arbiter needed a standardized way to implement GitHub issues: branch creation, planning, TDD, code review, gate verification, PR creation, and issue closing — all in a repeatable, auditable sequence.

## Decision

Implement a `/task #NNN` slash command in `.claude/commands/task.md` that drives the full lifecycle from issue to merged PR. The command uses phase state files (`.claude/.task-phase`, `.claude/.task-id`) to track progress across compaction events.

## Consequences

### Positive

- Consistent implementation quality across all issues
- Gate runs are mandatory before commit — no bypassing
- Review agents are dispatched programmatically, not optionally
- Phase state survives context compaction

### Negative

- Adds ceremony for trivial one-line fixes
- State files must be manually cleaned up or ignored via `.gitignore`

## Links

- Issues: #195, #196, #197
