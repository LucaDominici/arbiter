---
title: 'arbiter vs SuperClaude'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: []
related: []
---

# arbiter vs SuperClaude

SuperClaude is a Claude Code enhancement framework. It extends the Claude Code UX with custom slash commands, specialized personas, and an optimized prompt library designed to make Claude Code more productive for common development tasks.

---

## What SuperClaude does

- Adds custom slash commands to Claude Code (build, test, review, analyze, and others)
- Provides specialized personas that configure Claude's behavior for specific task types
- Includes a curated prompt library tuned for software development workflows
- Focuses on improving _day-to-day UX_ of Claude Code sessions

SuperClaude is a **Claude Code UX enhancer**. Its primary value is productivity: more useful commands, better-tuned prompts, less friction in the Claude Code interface.

## What arbiter does

arbiter is a **governance installer**. It generates the project-level artifacts that enforce quality standards: hook scripts that block violations at write time, gate commands that fail CI on coverage or lint regressions, and AGENTS.md that defines the invariants any AI tool must follow.

arbiter works across tools. Its governance artifacts apply whether you are using Claude Code or Codex (the supported tools out of the box; Cursor and others are experimental).

---

## Feature comparison

| Capability                                              | arbiter | SuperClaude |
| ------------------------------------------------------- | ------- | ----------- |
| Enhanced slash commands                                 | —       | ✓           |
| Specialized Claude personas                             | —       | ✓           |
| Curated prompt library                                  | —       | ✓           |
| Governance file (AGENTS.md)                             | ✓       | —           |
| Blocking hook scripts                                   | ✓       | —           |
| CI workflow generation                                  | ✓       | —           |
| Multi-tool configuration emission (Claude Code + Codex) | ✓       | n/r         |
| Multi-model review / orchestration                      | —       | n/r         |
| Language-aware setup                                    | ✓       | —           |
| L1/L2/L3/L4 governance tiers                            | ✓       | —           |
| Zero telemetry guarantee                                | ✓       | —           |

`n/r` means this arbiter-focused correction did not reassess SuperClaude's corresponding capability.

---

## When to choose SuperClaude

- You use Claude Code exclusively and want a richer command set and better prompts
- Your focus is improving productivity within Claude Code sessions
- You want specialized personas that tune Claude's behavior for architecture, debugging, or code review tasks
- You do not need mechanical enforcement beyond what Claude Code provides natively

## When to choose arbiter

- You need governance rules that _cannot be bypassed_ — hooks that block violations regardless of how the AI is prompted
- You need the same governance to work across Claude Code and Codex (with experimental support for Cursor and others)
- You want CI to fail on governance violations, not just rely on AI cooperation
- You need a complete, language-specific project setup (AGENTS.md + hooks + CI + GitHub infrastructure) from one install

## Using both together

SuperClaude enhances the _Claude Code experience_; arbiter enforces the _project rules_. Both can be active simultaneously: SuperClaude's commands and personas operate on top of the hook infrastructure arbiter generates. A developer using SuperClaude personas in an arbiter-governed project gets better UX with the same mechanical enforcement.

---

_Last reviewed: 2026-08-26_
