# Handoff: {{TOPIC}}

**Date:** {{DATE}} · **Author:** _fill in — model + session that authored this_
**Source truth:** _fill in — path(s) to the evidence this handoff summarizes (audit report, plan doc, ADR, commit range)_
**Executor:** any competent model. Name a stronger tier per-task below only where a task genuinely requires judgment, not execution.
**Prime directive:** this file is memory for a COLD model with zero prior context. It must be executable without re-derivation — every task below carries its own AC and verification command.

---

## Context

_Fill in — 2-4 sentences: what was found, why it matters, and the evidence backing the claim (link a commit, issue, or report; do not just assert)._

## Evidence pointers

- _path/URL to primary evidence #1_
- _path/URL to primary evidence #2_

## Tasks (execute in strict order — each depends on the previous landing)

### 1. _Atomic task title_

- **What:** _one concrete paragraph — no "and also consider" scope creep._
- **Where:** _files/dirs touched._
- **AC:** _observable, falsifiable acceptance criterion._
- **Verify:** `<exact command that proves the AC — test run, build, or script>`
- **Suggested tier:** cheap (execution) — bump to expensive only if this task is root-cause/architecture judgment, not execution.

### 2. _Next atomic task title_

- **What:** …
- **Where:** …
- **AC:** …
- **Verify:** `…`
- **Suggested tier:** …

_(repeat one numbered section per atomic task; keep them small enough that a cold model can finish one per turn)_

## Non-goals

_Fill in — what this handoff explicitly excludes, so the executing model does not scope-creep into adjacent work._

---

_Model-pyramid note (see AGENTS.md, "Model-Pyramid: 90/10 Guidance"): most tasks above should need only a cheap model executing this plan as written. If an expensive model ends up doing more than a judgment call on one of them, the task description was under-specified — fix the task, not the model tier._
