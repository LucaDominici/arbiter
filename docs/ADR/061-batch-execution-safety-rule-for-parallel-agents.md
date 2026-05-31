---
title: 'ADR-061: Batch-execution safety rule for parallel agents (#722, 2026-05-16)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '061'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-061: Batch-execution safety rule for parallel agents (#722, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #722
**Closes:** #722

**Context:** Claude Code supports spawning parallel sub-agents via the `Agent` tool. Concurrent agents that write shared state (git index, lockfiles, shared directories) cause non-deterministic corruption that is hard to recover from. No explicit rule existed to guide safe parallelism.

**Decision:** Emit a static Markdown rule file `50-batch-execution.md` via `generateClaudeRules` with `skipIfExists: true`. The rule codifies three things: (a) conditions under which read-only parallel agents are safe, (b) an explicit prohibition list (edits, commits, dependency installs, branch creation, deletes), and (c) a recovery protocol for parallel-agent collisions.

**Consequences:**

- Generated projects get a clear, enforceable rule about parallel agent safety at the governance level they need.
- `skipIfExists: true` lets project teams override/extend the rule without arbiter overwriting their customization on re-run.
- The rule is static Markdown (no EJS) — no template variables needed, reducing complexity.
