---
generated: true
source: 'docs/REFERENCE/coverage/dim-47-orphan-todo-check-no-bare-todos-without-task-ids.md'
source_sha: '3b456388fa45ec2b5227598d74858942b0508c28'
last_updated: '2026-06-06'
---

# N47: Orphan TODO check (no bare TODOs without task IDs)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-47-orphan-todo-check-no-bare-todos-without-task-ids.md](../docs/REFERENCE/coverage/dim-47-orphan-todo-check-no-bare-todos-without-task-ids.md)

<!-- arbiter-generated dim=N47 hash=0900bad213c95decfdfacea9aa5ba4294c8901f9ea5c186ac9efe958c16cd732 generator=kit@1 -->

# N47: Orphan TODO check (no bare TODOs without task IDs)

| Field     | Value              |
| --------- | ------------------ |
| TML       | L1                 |
| Gate      | BLOCKING           |
| Status    | covered            |
| Category  | scripts_validation |
| Invariant | `INV-06`           |

## Notes

check-no-orphan-todo.mjs gates orphan TODOs at L1; post-edit hook enforces inline

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
