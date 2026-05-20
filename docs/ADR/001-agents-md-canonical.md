---
title: 'ADR-001: AGENTS.md as canonical governance source'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-001: AGENTS.md as canonical governance source

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

AI coding tools each have their own config file format:

- Claude Code: `CLAUDE.md` / `.claude/`
- Codex: `AGENTS.md` / `.agents/`
- Cursor: `.cursorrules`
- Copilot: `.github/copilot-instructions.md`
- Gemini CLI: `GEMINI.md`

Maintaining governance in each tool's native format causes drift. The question was: which file is the canonical source?

## Decision

`AGENTS.md` is the canonical source. All other tool configs are thin pointers.

## Rationale

1. **Linux Foundation standard** -- AGENTS.md was co-donated to the AAIF by Anthropic and OpenAI (December 2025). It is not a proprietary format.
2. **Universal adoption** -- Claude Code, Codex, Cursor, Copilot, Gemini CLI, and Windsurf all read `AGENTS.md` natively as of early 2026.
3. **Single maintenance point** -- governance changes propagate to all tools without per-tool updates.
4. **Academically correct** -- aligns with the AAIF interoperability vision: one file, all agents.

### Alternatives rejected

- **CLAUDE.md as canonical** -- Anthropic-specific; Codex/Cursor don't read it natively.
- **Per-tool canonical sources** -- drift is guaranteed and cross-tool consistency is impossible.
- **Shared config via symlink** -- breaks on Windows and in many CI environments.

## Consequences

**Positive:**

- Single place to update governance rules for all AI coding tools.
- Aligns with the emerging industry standard (AAIF).
- No vendor lock-in to any specific tool's format.

**Negative:**

- Teams unfamiliar with AGENTS.md need onboarding on the convention.
- Tool-specific features that don't map to AGENTS.md still need separate files (addressed by ADR-002).
