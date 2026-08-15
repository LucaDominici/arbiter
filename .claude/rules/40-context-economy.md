---
title: 'Context Economy'
doc_version: '1.0.0'
status: active
last_review: '2026-05-27'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'kind/internal']
related: []
---

# Context Economy

## Principle

Read the minimum context needed for the current task. Every unnecessary file read wastes tokens and slows responses.

## Minimum Startup Set

Every task reads, regardless of track:

- `AGENTS.md` (invariants + governance)
- `docs/INDEX.md` (generated doc index)
- `.claude/knowledge-map.json` (machine-readable track routing)
- The specific file(s) the task touches

## Track Routing

Detect your track from the task's target paths before reading broad context.
Full routing table is in `.claude/knowledge-map.json`.

| Track    | Signal paths                         | Load additionally                                    |
| -------- | ------------------------------------ | ---------------------------------------------------- |
| frontend | `*.tsx`, `*.vue`, `*.svelte`, `web/` | `<project>/docs/internal/METHOD/FRONTEND_CONTEXT.md` if exists |
| backend  | `*.go`, `*.py`, `*.java`, `api/`     | `<project>/docs/internal/METHOD/BACKEND_CONTEXT.md` if exists  |
| docs     | `docs/`, `*.md`                      | `docs/INDEX.md` only                                 |

## Rules

- Do not speculatively read all files in a directory.
- Do not re-read files already in context.
- Do not load unrelated track docs for a focused single-track task.
- When track is unknown, load the minimum startup set and ask rather than reading broadly.
