---
title: 'ADR-096: Probe — always-on incidental-discovery loop'
doc_version: '1.0.0'
status: active
last_review: '2026-06-15'
owner: ''
canonical_id: '096'
tags: ['audience/dev', 'kind/adr']
related: ['088-ship-as-orchestration-entrypoint', '093-dual-side-ship-orchestrator']
---

# ADR-096: Probe — always-on incidental-discovery loop

**Project:** arbiter
**Date:** 2026-06-15
**Status:** Accepted
**Epic:** #1400 (children #1401–#1406)

## Context

While an agent reads code to do task X, it forms many out-of-scope judgments — "this duplicates
that helper", "this errno handler doesn't translate EACCES", "this doc claims a `.sh` that's now
`.mjs`". Today **100% of that signal is discarded** the moment the task closes: working memory is
wiped on `/clear`, and only the in-scope change survives.

The only existing capture primitive, `arbiter task record-tech-debt`, shells out to
`gh issue create` (≤30s, network, auth) **synchronously, on the agent's critical path**, and is
documented single-writer (lost updates under the parallel `/drain` worktrees). So the economics are
backwards: ignoring a finding costs one token, capturing it costs a 30s blocking subprocess and a
context-switch to GitHub semantics — therefore agents ignore. This is the root cause to fix.

This decision was reached by three orthogonal design agents (capture / lifecycle / strategy) that
independently converged on the same loop.

## Decision

Adopt **Probe**, an always-on incidental-discovery loop, built ~90% from existing machinery
(`record-tech-debt`, `gen-gap`/`GAP.md`, debt-ratchet, `/drain`, `/impact`/graphify, the
`.arbiter/**`+negation gitignore, the `bypass-log.jsonl` JSONL precedent) — CANON-16 refactor-first,
not a parallel system.

The loop:

1. **Capture (free):** `arbiter note` appends one JSON line to a per-agent spool
   `.arbiter/findings/<shard>.jsonl` — non-blocking, no network, parallel-safe (one shard per
   writer; no shared-file race). Bookkeeping is auto-captured (`foundDuring`, `file:line`, `sha`,
   graphify node id, `fingerprint`); the agent types only the insight.
2. **Behavioral guarantee:** rule `60-incidental-capture.md` makes capture **terminal** for an
   out-of-scope finding within the current task (notice ≠ fix), and the `pre-edit-plan-anchor`
   backstop converts an out-of-scope edit attempt into a "run `arbiter note`, don't fix here"
   redirect — making capture the path of least resistance.
3. **Promote (drain):** `arbiter findings promote` dedups (by fingerprint, preferring the
   line-stable graphify node id) within the spool and against open issues, **re-validates each
   survivor against HEAD and drops findings whose code already vanished** (kills stale-issue spam),
   and files survivors as GH issues via the shared `record-tech-debt` path — which already flows
   into `GAP.md` untouched. Default trigger: `/drain` Phase 0.5; manual escape hatch available.
4. **Prove + reward draining:** `openFindingsCount` becomes a lower-is-better ratchet metric and a
   conformance (#1369) discipline dimension. Headline signals reward findings **closed** and
   conformance movement — never findings **opened**.

### Resolved design decisions

- **Storage:** local-ephemeral JSONL shards (capture) → **GH issues as the SSOT** (durable backlog).
  No committed shared backlog file (avoids merge conflicts + gate churn).
- **Promotion:** `/drain` Phase 0.5 (default) + manual `arbiter findings promote`. No cron daemon.
- **Auto-capture:** agent-rule + cheap verb + plan-anchor backstop + end-of-task reflection sweep.
  **No** noisy automatic scope-drift detection.
- **Capture bar:** CANON-22 "blocking-eligible" only (dup-of-helper, missed-extraction,
  root-cause-vs-symptom); a deterministic evidence ref (file:line / graph node) is required.

## Consequences

**Positive.** The code read is already paid for, so incidental audit is ~free, intent-aware
(LLM, not a linter), and work-driven (densest where development is hottest). arbiter uniquely owns
**both** halves — discovery and drain — so findings die merged-green instead of rotting in a
dashboard, and the conformance score climbs as a side effect of normal work. It is the completion
of arbiter's "guardrails / proof-touches-reality" thesis applied to exploration.

**Negative / risks.** A capture-only feature degenerates into an alert-fatigue graveyard. Mitigated
by, and conditional on: (a) capture + drain shipped as **one** loop; (b) a ruthless capture bar +
mechanical dedup; (c) rewarding _drained_, not _filed_; (d) re-validate-against-HEAD so stale
findings are never filed; (e) a promote-before-`/clear` nudge + age-based promote-or-drop sweep so
the spool can't rot. In a project that never runs `/drain`, the loop degrades to manual
`arbiter findings promote` (weaker "automatic" promise, still functional).

## Alternatives considered

- **Eager per-finding `gh issue create` (status quo extended).** Rejected: keeps the backwards
  economics (network on the hot path) and the single-writer race; this is exactly what suppresses
  capture today.
- **Committed shared backlog file.** Rejected as SSOT: merge conflicts across parallel worktrees
  and gate churn. GH issues are the durable store; the JSONL spool is the cheap, ephemeral inbox.
- **Automatic scope-drift detection via heuristics/hook.** Deferred: noisy, low signal-to-noise.
  Start with an agent-rule + a frictionless verb + a plan-anchor redirect.

## References

- Epic #1400; build issues #1401–#1406.
- Complements #1363 (proof-touches-reality) and the conformance scorecard #1369.
- Reuses: `src/commands/task-record-tech-debt.ts`, `scripts/gen-gap.mjs`, `scripts/debt-lib.mjs`,
  `.claude/skills/wave-drain/SKILL.md`, `.claude/skills/impact/SKILL.md`, `.claude/rules/55-brainstorm-terminal-state.md`.
