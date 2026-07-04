---
title: 'ADR-002: Thin pointer pattern for tool overlays'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '002'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-002: Thin pointer pattern for tool overlays

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Tool-specific files need to exist because each tool has unique configuration that doesn't belong in `AGENTS.md` (hooks wiring for Claude, plan JSON schema for Codex, slash commands). The question was how much content to put in each file.

## Decision

Tool configs are thin pointers: they open with an explicit reference to `AGENTS.md`, then add only what that tool uniquely needs. No governance content is duplicated.

Template:

```markdown
# {project} -- Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

## Rationale

- Eliminates governance drift between tool config files.
- Each tool file remains small and focused on tool-specific concerns (hooks, permissions, schemas).
- The pointer is explicit and human-readable -- developers immediately know where governance lives.

### Alternatives rejected

- **Full CLAUDE.md with all governance** -- this was the pre-arbiter state in prior-art baseline repos (prior internal projects). It caused drift because each repo's CLAUDE.md diverged independently.
- **Empty pointer with no tool config** -- rejected because tool-specific config (hooks, permissions) genuinely needs to live somewhere.

## Consequences

**Positive:**

- Governance is maintained in exactly one place (AGENTS.md).
- Tool-specific configs stay minimal and easy to review.
- Adding a new tool requires only a new thin pointer file.

**Negative:**

- Developers must follow the convention of not putting governance into tool files.
- The pointer comment is a social contract, not enforced mechanically (could add a lint rule later).
