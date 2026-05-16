# Safe Parallel Batch-Execution Contract

## When parallel agents are allowed

Parallel agent dispatch is permitted **only** when every agent in the batch is:

- **Read-only**: the agent reads, searches, or fetches — it does not write files, run builds, or shell out with side effects.
- **File-discovery or research**: the agent's job is to locate, inspect, or summarise existing artefacts.

## Hard prohibitions (never parallelise)

| Operation                           | Reason                                           |
| ----------------------------------- | ------------------------------------------------ |
| File edits or writes                | Race conditions, lost-update hazards             |
| Git commits or pushes               | Non-deterministic history                        |
| Dependency installs                 | Concurrent lock-file writes corrupt the manifest |
| Test runs that mutate state         | Flaky interference between concurrent suites     |
| Any shell command with side effects | Order-dependent output                           |

## Anti-rot checklist (machine-checkable)

Before dispatching a parallel batch, verify each item:

- [ ] All agents in the batch are read-only (no `Edit`, `Write`, `Bash` with mutations)
- [ ] No agent installs, commits, or pushes
- [ ] No shared mutable resource is accessed (lock files, temp dirs, DB)
- [ ] Each agent's result is independent (order does not matter)

Fail the batch if any item is unchecked.
