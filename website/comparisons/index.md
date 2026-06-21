---
title: 'Comparisons'
doc_version: '1.0.0'
status: active
last_review: '2026-06-22'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Comparisons

How arbiter fits alongside other AI governance and workflow tools.

## What arbiter is (and isn't)

Arbiter's **core** is a **governance installer** — it sets up the files, scripts, and hooks that enforce quality standards in a project. It is not a chat client and not a replacement for an AI coding tool. On top of that core it ships an **optional orchestration layer** (`/ship`, `/drain`, and four sub-agents) that can drive issues to merged PRs against the same governance contract; the installer core is fully usable without it.

Most alternatives in this space are persona frameworks: they tell the AI _who to be_. Arbiter tells the AI _what rules apply_ and _enforces them mechanically_ at commit, push, and CI. It is **not** a persona framework.

## Feature Matrix

| Capability                          | arbiter | BMAD | GSD2 | claude-flow | SuperClaude | spec-kit |
| ----------------------------------- | ------- | ---- | ---- | ----------- | ----------- | -------- |
| Canonical governance file           | ✓       | —    | —    | —           | —           | —        |
| Multi-tool support (Claude + Codex) | ✓       | —    | ✓    | —           | —           | —        |
| Language-aware generation           | ✓       | —    | —    | —           | —           | —        |
| L1/L2/L3/L4 governance tiers        | ✓       | —    | —    | —           | —           | —        |
| Generated hook scripts              | ✓       | —    | —    | —           | —           | —        |
| GitHub infrastructure               | ✓       | —    | —    | —           | —           | —        |
| CI workflow generation              | ✓       | —    | —    | —           | —           | —        |
| Idempotent update                   | ✓       | —    | —    | —           | —           | —        |
| Specialized sub-agents¹             | ✓       | ✓    | ✓    | ✓           | ✓           | —        |
| Autonomous task execution¹          | ✓       | —    | ✓    | ✓           | —           | —        |
| Parallel agent orchestration¹       | ✓       | —    | —    | ✓           | —           | —        |
| Agent personas / role definitions   | —       | ✓    | —    | —           | ✓           | —        |
| Spec-driven development             | —       | —    | —    | —           | —           | ✓        |
| npx install                         | ✓       | —    | —    | —           | —           | —        |
| Zero telemetry                      | ✓       | —    | —    | —           | —           | —        |

> **Key:** ✓ = present, — = not present or not a stated goal.
> **¹** Provided by arbiter's _optional orchestration layer_ (`/ship`, `/drain`, and the
> `bridge-reviewer`/`codebase-scanner`/`context-checker`/`red-team` sub-agents), which is distinct
> from — and not required by — the installer **core**. Arbiter does **not** ship agent _personas_.
> "Claude + Codex" are the supported tools out of the box; Cursor, Copilot, Windsurf, Aider, and
> Gemini CLI generators exist but are **experimental** (behind `--accept-beta-tools`).

## When to choose arbiter

- You want CI to fail on governance violations, not just warn
- You're setting up governance for TypeScript, Java, Rust, Go, or Python projects
- You need a tool that works with all major AI coding tools from one install
- You want to enforce coding standards mechanically, not just document them
- You need GitHub infrastructure (labels, branch protection, PR templates) provisioned consistently

## When to choose an alternative

- You need a **persona-driven creative workflow** → BMAD
- You need **autonomous multi-step task execution** → GSD2 or claude-flow
- You need **spec-first requirements management** → spec-kit
- You want **enhanced Claude Code commands and UX** → SuperClaude

## Detailed comparisons

- [vs spec-kit](/comparisons/spec-kit)
- [vs BMAD](/comparisons/bmad)
- [vs GSD2](/comparisons/gsd2)
- [vs claude-flow](/comparisons/claude-flow)
- [vs SuperClaude](/comparisons/superclaude)

---

_Last reviewed: 2026-06-22_
