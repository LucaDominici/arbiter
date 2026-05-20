---
name: ssot-navigation
description: Use when starting any task to determine which arbiter SSOT documents to read and in what order.
title: 'SSOT Navigation'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# SSOT Navigation

## Decision Hierarchy

When documents conflict, higher level wins.

| Level | Authority                        | Path                      |
| ----- | -------------------------------- | ------------------------- |
| 1     | Invariants + governance contract | `AGENTS.md`               |
| 2     | Architecture decision records    | `docs/ADR/`               |
| 3     | Process rules                    | `docs/SYSTEM/CANON.md`    |
| 4     | Active task plan                 | `.claude/plans/<task>.md` |
| 5     | AI judgment                      | (last resort)             |

## SSOT Document Index

| Document             | Path                           | Purpose                                      | When to read                             |
| -------------------- | ------------------------------ | -------------------------------------------- | ---------------------------------------- |
| Governance contract  | `AGENTS.md`                    | Invariants, authority hierarchy, tool config | Every task, first                        |
| Process rules        | `docs/SYSTEM/CANON.md`         | 15 CANON-NN constraints from audit waves     | Before adding hook/gate/template/command |
| Decision records     | `docs/ADR/`                    | Architectural decisions with rationale       | Before changing existing abstractions    |
| Knowledge map        | `docs/METHOD/KNOWLEDGE_MAP.md` | Line-range pointers into key files           | When orientation is slow                 |
| SSOT core set        | `docs/METHOD/SSOT_CORE_SET.md` | Minimal reading list per task type           | When uncertain which docs apply          |
| Invariant catalog    | `src/invariants/catalog.ts`    | Machine-readable INV-NN entries              | Before adding a new invariant            |
| Generated invariants | `GLOBAL_INVARIANTS.md`         | Rendered output for target projects          | To verify filter/render pipeline         |
| Decisions log        | `docs/SYSTEM/DECISIONS.md`     | Running ADR index                            | Before changing architectural scope      |

## Key Line-Range Pointers

| Reference               | Location                                          |
| ----------------------- | ------------------------------------------------- |
| Authority Hierarchy     | `AGENTS.md §Authority Hierarchy L22-32`           |
| Invariant list          | `AGENTS.md §Invariants L34+`                      |
| How to add an invariant | `docs/SYSTEM/CANON.md §How to add new entry L21+` |
| Filter short-circuit    | `src/invariants/filter.ts:23-37`                  |
| Task evidence path      | `src/commands/task.ts:194-208`                    |

## Quick Lookup Commands

```bash
# Find where an invariant is cited
grep -n "INV-NN" AGENTS.md

# List issues tagged with a CANON rule
gh issue list --label "canon/NN-*"

# Explain an invariant in human language
arbiter explain INV-NN

# List all active invariants (core set, default filter)
arbiter invariants list
```

## Anti-Patterns

- Starting implementation without reading `AGENTS.md §Invariants` — risks INV violation on first edit
- Assuming an ADR exists without opening `docs/ADR/` — ADRs are sparse; verify before citing
- Adding a hook, gate, or template without checking CANON before CANON-01/04/07/10/11/15
- Editing `AGENTS.md` without `ARBITER_SSOT_BYPASS=1` — `pre-edit-ssot-guard.mjs` hard-blocks
