---
title: 'ADR-097: Context-rot-management skill (CLI-first 3-layer redundancy)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-19'
owner: ''
canonical_id: '097'
tags: ['audience/dev', 'kind/adr']
related: ['020-cli-first-over-mcp', '088-ship-as-orchestration-entrypoint']
---

# ADR-097: Context-rot-management skill (CLI-first 3-layer redundancy)

**Project:** arbiter
**Date:** 2026-06-19
**Status:** Accepted
**Epic:** #1438 (child #1440)

## Context

On a long, multi-phase task the context window eventually compacts and in-memory state is lost. The
agent then either silently drops acceptance criteria or re-does completed work. arbiter already owns
every primitive needed to survive this — the inline BACKLOG.md template embedded in the
`context-rot-management` skill (the standalone `evidence-backlog` generator that emitted an
orphan `.evidence/BACKLOG.md.template` was removed as dead — #1887-C), `.claude/hooks/pre-compact.mjs` (re-grounds the model on compaction), the
`arbiter mark` task cursor, and `docs/REFERENCE/task-recovery.md` — but there was **no skill** tying
them into a single protocol and **no activation heuristic** telling the agent when the discipline is
worth its overhead. The pieces existed; the discipline did not.

A predecessor configuration solved this with a proven 3-layer protocol, but its checkpoint layer was
an MCP `save_memory` call — incompatible with arbiter's CLI-first stance (ADR-020) and unusable in a
governed target project that ships no MCP server.

## Decision

Add a `context-rot-management` skill (`.claude/skills/context-rot-management/SKILL.md`) that ties the
existing primitives into a **3-layer durable-redundancy protocol**, any one layer of which fully
recovers the task:

1. **BACKLOG snapshot** — `.arbiter/evidence/<task-id>/BACKLOG.md` (append-only per-phase state).
2. **Task cursor** — `arbiter mark` (last / next / digest), the **CLI-native** checkpoint that
   replaces the predecessor's MCP `save_memory` (ADR-020 compliance).
3. **Git log** — phase-boundary commits.

Activation is a deterministic heuristic — `Tier = Standard AND (implementation_units > 5 OR explicit
user request)` — so small Standard tasks, which a 1M-context model handles natively, pay no overhead.
Recovery is an ordered procedure (BACKLOG → cursor → git log → resume re-reading only "remaining"
files, never the generic SSOT set).

The skill lands Track-A (arbiter self) first. Generating it into target projects (Track-B) is
deferred to the progressive-adoption work (#1447), where the BACKLOG generator is ungated below L4.

## Consequences

**Positive:** long `/ship` runs survive compaction with zero re-work and no single point of failure;
the checkpoint is CLI-first, so the same protocol works in any governed project without MCP; the
activation heuristic keeps small tasks overhead-free.

**Negative / trade-offs:** the discipline adds three writes per phase boundary on large tasks (the
heuristic confines this to where it pays off); the BACKLOG generator remains L4-gated until #1447
ungates it for downstream projects.

**Neutral:** claude-mem MCP, when present, remains an optional extra layer — it is never required and
never the canonical checkpoint.
