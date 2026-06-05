---
title: 'ADR-088: /ship as the Single Orchestration Entrypoint'
doc_version: '1.0.0'
status: active
last_review: '2026-06-05'
owner: ''
canonical_id: '088'
tags: ['audience/dev', 'kind/adr']
related: ['041-task-workflow']
---

# ADR-088: /ship as the Single Orchestration Entrypoint

**Status:** Active — supersedes ADR-041 (#1216, 2026-06-05)

## Context

ADR-041 (2026-05) established `/task` as the full task lifecycle command. Simultaneously, `/ship`
(#1206) was introduced as an auto-advance orchestrator layered on top of the `arbiter task` engine.
Both described "how to run a task," creating two competing narratives. The `/task` manual-phase
checklist duplicated what `/ship`'s auto-advance loop now owns, and ship.md was missing several
evidence steps (agents-dispatched.json sidecar, done-evidence.mjs, red-team evidence path, local-state
setup) that other enforcement depends on.

## Decision

**`/ship` is the single orchestration entrypoint.** It is the command users and AI agents invoke to
drive an issue to a merged PR. The `arbiter task` CLI and state machine remain as the low-level engine
that `/ship` drives, documented in `/task` as a subcommand reference (not an orchestration checklist).

Specifically:

1. **`/ship` is self-sufficient** — it documents all steps a reader must perform to avoid tripping
   gates, including: local-state setup (.git/info/exclude), red-team evidence, agents-dispatched.json
   sidecar (INV-114 Stop hook), done-evidence.mjs (INV-38), and acceptance-criteria verification.

2. **`/task` is the engine reference** — it documents subcommands (init/advance/resume/recover/
   record-red/record-tech-debt/get), the PHASE_ORDER state machine, manual recovery, and tech-debt
   filing. No orchestration prose.

3. **Dual-sided consistency** — arbiter's own `.claude/` files and the generated templates in
   `src/templates/` reflect the same narrative. The dogfood parity gate (`check-self-dogfood.mjs`)
   enforces this mechanically. The `check-self-dogfood.mjs` buildRenderContext is extended to read
   `collaborationMode + mergeMode` from `arbiter.json` so trunk-solo conditional blocks render
   correctly in parity checks.

4. **All narrative surfaces updated** — CLAUDE.md.ejs, 90-exec-protocol.md.ejs (Claude + Codex),
   CODEX.md.ejs, /replay phase mapping, QUICKSTART.md, task-recovery.md, migration recipes,
   OVERVIEW.md, and FEATURE_MATRIX (REQ-053 /ship row → Verified).

## Consequences

- A reader following only `/ship` will not trip any gate (INV-114, INV-38).
- `/task` stops being the "full lifecycle" command; its description changes to "low-level engine/CLI."
- `/replay` phase mapping updated to reference `/ship` sections.
- The duplicate manual checklist in task.md is eliminated; jscpd duplication ratchet stays green.
