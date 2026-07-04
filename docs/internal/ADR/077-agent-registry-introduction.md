---
title: 'Agent Registry Introduction'
doc_version: '1.0.0'
status: active
last_review: '2026-05-17'
owner: ''
canonical_id: '077'
tags: ['audience/dev', 'kind/adr']
related: ['053']
---

# ADR-077: Agent Registry Introduction

**Project:** arbiter
**Date:** 2026-05-17
**Status:** Accepted
**Reference:** Issue #696

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-053.
> That ID was later reused for a different decision (CI gap closures, `docs/ADR/053-ci-gap-closures-and-check-ladder.md`).
> Content extracted here as ADR-077 to resolve the collision.

## Context

Arbiter's `.claude/agents/` directory contained four sub-agents (bridge-reviewer, codebase-scanner, context-checker, red-team) with no canonical index documenting their models, effort tiers, cost rationale, or interaction chains. The `.claude/rules/05-agent-lifecycle.md` already required `docs/SYSTEM/DECISIONS.md` updates for architectural agent changes, but the registry artifact itself was missing.

## Decision

Create `.claude/AGENT_REGISTRY.md` as the canonical index of all sub-agents. It records: agent name, model, effort, cost rationale, six interaction chains (task start/completion/E2E fail/gate fail/migration/library lookup), and an escalation hierarchy. Update `.claude/rules/05-agent-lifecycle.md` to require AGENT_REGISTRY.md updates alongside the ADR log. Add a one-line pointer in `AGENTS.md` §Multi-Agent Tool Extensions.

## Consequences

### Positive

- Adding or removing agents now requires three artifacts: the agent file, the registry row, and an ADR entry. This makes the agent fleet self-documenting and auditable.

### Negative

- Slight overhead per agent change: three files to update instead of one.

## Links

- Issues: #696
