---
name: context-rot-management
description: Use during Standard-tier tasks with more than 5 implementation units, or when the context window is approaching compaction, or when resuming after /clear or an auto-compaction. A 3-layer durable-redundancy protocol (BACKLOG snapshot + task cursor + git log) that makes context loss a non-event with zero single point of failure. NOT auto-activated for small Standard tasks — a 1M-context model handles those natively.
argument-hint: '[--activate] [--recover]'
title: 'Context-Rot Management (3-layer durable redundancy)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-19'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/orchestration']
related: ['tdd', 'verification', 'task', 'ship']
---

# Context-Rot Management (3-layer durable redundancy)

**Authority:** Proven on a long multi-phase task (100+ specs, 5 phases, one mid-task compaction, zero re-work).
**Trigger:** Deterministic heuristic (see _When this applies_).
**Enforcement:** MANDATORY once activated — skipping a checkpoint requires an explicit human override.

Context compaction destroys in-memory state. This skill keeps three **independent** durable records of the task, any one of which can fully recover it. CLI-first by design (ADR-020): the checkpoint layer is `arbiter mark`, not an MCP call, so it works in any governed project with no MCP dependency.

---

## When this applies

**Activation condition:**

```
Tier = Standard  AND  (implementation_units > 5  OR  user requests explicitly)
```

A 1M-context model handles compaction for most Standard tasks natively, so auto-activating every task only adds BACKLOG overhead with no benefit when units are few.

**Evaluated at:** end of the `/ship` (or `/task`) plan phase, after GO, once the implementation-unit count is known.

| Scenario | Tier     | Units | Result                                |
| -------- | -------- | ----- | ------------------------------------- |
| A        | Standard | > 5   | **ACTIVATE**                          |
| B        | Standard | ≤ 5   | SKIP — small task, handled natively   |
| C        | Standard | any   | **ACTIVATE** on explicit user request |
| D        | S        | any   | SKIP — tier below Standard            |
| E        | XS       | any   | SKIP — tier below Standard            |

---

## The 3 layers

| Layer              | Artifact                                            | Survives            | How to access       |
| ------------------ | --------------------------------------------------- | ------------------- | ------------------- |
| **1. BACKLOG**     | `.arbiter/evidence/<task-id>/BACKLOG.md`            | git push            | Read tool           |
| **2. Task cursor** | `arbiter mark` (last / next / digest in task state) | `/clear`, recompute | `arbiter task get`  |
| **3. Git log**     | phase-boundary commits                              | git history         | `git log --oneline` |

Any single layer failing → the other two still recover the task. Zero single point of failure. (`pre-compact.mjs` additionally re-grounds the model immediately after a compaction by printing branch / task / phase to stdout.)

---

## Initialization

When the activation condition is met, immediately after GO (before the first implementation unit):

1. Create `.arbiter/evidence/<task-id>/BACKLOG.md` from the template below.
2. Populate the header from the plan's Context Block.
3. Add the first phase section (files listed, not yet started).

`<task-id>` is the sanitized issue id (e.g. `1440`), matching the arbiter evidence convention.

### BACKLOG.md template

```markdown
# Task BACKLOG — #<ISSUE> <title>

**Branch:** task/#<ISSUE>-<slug>
**Tier:** Standard
**Activated:** context-rot-management (units > 5)
**Last updated:** <date>

---

## Phase <N>/<M> — <phase-name>

**Status:** [IN PROGRESS | DONE | BLOCKED]

### Files done (<count>/<total>)

- `path/to/file.ext` — <one-line summary>

### Files remaining (<count>)

- `path/to/file.ext` — <what remains>

### Decisions

- **<decision>:** <what> — Why: <rationale> — Ref: <INV-NN / ADR-NNN / file:line>

### Issues

- [OPEN] <blocker or risk>
- [RESOLVED] <past blocker — kept for recovery context>
```

Append a new section per phase. **Never delete old phase sections** — they _are_ the recovery context.

---

## Phase-transition checklist

Run all three at every phase boundary (finishing phase N, starting N+1):

1. **Update BACKLOG** — add the new phase section (status of the completed phase, files done/remaining, decisions, issues).
2. **Pin the cursor** — `arbiter mark --last "<what was just done>" --next "<exact next action>" --digest "<one line>"`. This is the searchable, CLI-native checkpoint; it survives `/clear`.
3. **Commit** — one logical unit per the exec-protocol commit strategy; the message names the phase completed and what's next.

---

## Recovery after compaction

Execute in order; stop once state is fully recovered.

1. **Read** `.arbiter/evidence/<task-id>/BACKLOG.md` — current phase, files done/remaining, open decisions, open issues.
2. **Read the cursor** — `arbiter task get` (last / next / digest pinned by `arbiter mark`); recovers any decision not yet written to BACKLOG.
3. **Verify against git** — `git log --oneline`; confirm phase commits are present and resolve any discrepancy with the BACKLOG.
4. **Resume** — continue from the last checkpoint. Re-read **only** the files listed under "remaining". Do **NOT** re-read the generic SSOT docs (AGENTS.md, ADRs) unless a specific invariant is in question — that is context bloat, not recovery.

---

## Cleanup

No manual cleanup. The BACKLOG stays under `.arbiter/evidence/<task-id>/` (retained per the evidence-class policy); the cursor lives in task state; commits are permanent.

---

## Anti-patterns

**Never:**

- Skip a phase checkpoint ("I'll do it at the end") — defeats the purpose; checkpoints must survive a _mid-task_ compaction.
- Write decisions only in commit messages — not recoverable from task state.
- Use the BACKLOG as a to-do list — it is a **state snapshot**, not a backlog.
- Overwrite an old phase section — append only; old sections are recovery context.
- Re-read the full SSOT set on resume — re-read only "remaining" files.
