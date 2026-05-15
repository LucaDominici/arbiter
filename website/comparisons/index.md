# Comparisons

How arbiter fits alongside other AI governance and workflow tools.

## What arbiter is (and isn't)

Arbiter is a **governance installer** — it sets up the files, scripts, and hooks that enforce quality standards in a project. It is not a chat client, not an agent orchestrator, and not a replacement for an AI coding tool.

Most alternatives in this space are workflow or persona frameworks: they tell the AI _how_ to think. Arbiter tells the AI _what rules apply_ and _enforces them mechanically_ at commit, push, and CI.

## Feature Matrix

| Capability                        | arbiter | BMAD | GSD2 | claude-flow | SuperClaude | spec-kit |
| --------------------------------- | ------- | ---- | ---- | ----------- | ----------- | -------- |
| Canonical governance file         | ✓       | —    | —    | —           | —           | —        |
| Multi-tool support (7 tools)      | ✓       | —    | ✓    | —           | —           | —        |
| Language-aware generation         | ✓       | —    | —    | —           | —           | —        |
| L1/L2/L3 governance tiers         | ✓       | —    | —    | —           | —           | —        |
| Generated hook scripts            | ✓       | —    | —    | —           | —           | —        |
| GitHub infrastructure             | ✓       | —    | —    | —           | —           | —        |
| CI workflow generation            | ✓       | —    | —    | —           | —           | —        |
| Idempotent update                 | ✓       | —    | —    | —           | —           | —        |
| Specialized sub-agents            | —       | ✓    | ✓    | ✓           | ✓           | —        |
| Autonomous task execution         | —       | —    | ✓    | ✓           | —           | —        |
| Agent personas / role definitions | —       | ✓    | —    | —           | ✓           | —        |
| Spec-driven development           | —       | —    | —    | —           | —           | ✓        |
| npx install                       | ✓       | —    | —    | —           | —           | —        |
| Zero telemetry                    | ✓       | —    | —    | —           | —           | —        |

> **Key:** ✓ = core feature, — = not present or not a stated goal

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

_Last reviewed: 2026-05-15_
