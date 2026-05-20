---
title: 'ADR-004: skipIfExists on hooks, rules, and commands'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-004: skipIfExists on hooks, rules, and commands

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

When running `arbiter init` on an existing project, hook scripts, rules, and commands may already exist with project-specific customizations. The question was whether arbiter should overwrite these files on re-init.

## Decision

Hook scripts, rules, and commands use `skipIfExists: true`. Created on first install, never overwritten.

Exceptions:

- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` -- always replaced (backup kept). These are stateless thin pointers with no project-specific content.
- `settings.json` -- deep-merged (see ADR-005). Has both stateless (hook wiring) and stateful (custom permissions) sections.

The explicit update path is `rm <hook> && arbiter init` (or `arbiter update` in Phase 3).

## Rationale

- Hooks are the most project-customized part of `.claude/`. Overwriting them destroys local work.
- Thin pointers (AGENTS.md, CLAUDE.md, CODEX.md) are stateless by design and safe to regenerate.
- The explicit delete-then-reinit pattern gives users full control over when updates are applied.

## Consequences

**Positive:**

- Project customizations in hooks, rules, and commands are never lost on re-init.
- Predictable behavior: users know exactly which files are safe and which are regenerated.

**Negative:**

- Users don't automatically get updated hook templates when arbiter is upgraded. Must manually delete and re-init.
- Future `arbiter update` command needed to provide a smoother upgrade path (Phase 3).
