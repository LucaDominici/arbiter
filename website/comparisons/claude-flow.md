---
title: 'arbiter vs claude-flow'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: []
related: []
---

# arbiter vs claude-flow

claude-flow is an agent orchestration framework built around Claude. It coordinates networks of Claude-powered agents, manages shared memory and state, and enables parallel execution of complex multi-step tasks.

---

## What claude-flow does

- Orchestrates fleets of Claude agents working in parallel on decomposed tasks
- Manages shared context and memory across agent instances
- Provides structured coordination patterns (swarm, pipeline, hierarchical)
- Designed specifically to scale Claude's capabilities across large, multi-step problems

claude-flow is an **agent fleet coordinator**. Its primary value is parallelism and state management across many Claude instances operating on a single problem.

## What arbiter does

arbiter's **core** is a **governance installer**. It produces a static set of governance artifacts — AGENTS.md, hook scripts, gate commands, CI workflows — that define the rules any agent (including Claude agents) must follow. arbiter supports Claude Code and Codex out of the box (Cursor, Windsurf, and others exist as experimental generators).

arbiter _also_ ships an **optional orchestration layer** (`/ship`, `/drain`, four sub-agents) that can drive issues to merged PRs and dispatch parallel agents in isolated worktrees. The key distinction from claude-flow is that arbiter's orchestration is a thin layer over the governance contract — it has **no runtime fleet coordinator and no shared agent memory/state**; claude-flow is purpose-built around exactly those.

---

## Feature comparison

| Capability                                              | arbiter | claude-flow |
| ------------------------------------------------------- | ------- | ----------- |
| Multi-agent orchestration¹                              | ✓       | ✓           |
| Parallel agent execution¹                               | ✓       | ✓           |
| Shared agent memory/state                               | —       | ✓           |
| Runtime fleet coordinator                               | —       | ✓           |
| Governance file (AGENTS.md)                             | ✓       | —           |
| Blocking hook scripts                                   | ✓       | —           |
| CI workflow generation                                  | ✓       | —           |
| Multi-tool configuration emission (Claude Code + Codex) | ✓       | n/r         |
| Multi-model review / orchestration                      | —       | n/r         |
| Language-aware setup                                    | ✓       | —           |
| npx install in one step                                 | ✓       | —           |

> **¹** Via arbiter's _optional orchestration layer_ (`/ship`, `/drain`) — distinct from the installer
> core, and lighter-weight than claude-flow's runtime fleet coordination.
> `n/r` means this arbiter-focused correction did not reassess claude-flow's corresponding capability.

---

## When to choose claude-flow

- You need to coordinate many Claude agents working in parallel on a decomposed problem
- Your workflow involves large-scale autonomous task execution requiring shared state
- You are building Claude-native pipelines where agent coordination is the core challenge
- You need sophisticated memory and context management across agent instances

## When to choose arbiter

- You need governance rules enforced at the tool level — hooks that block violations before they land, not agent prompts that ask nicely
- You are working with multiple AI tools beyond Claude (Codex out of the box; Cursor, Windsurf experimental) and need consistent governance across all of them
- You want a complete project governance setup (AGENTS.md + hooks + CI) in one install that works without an ongoing runtime
- You need CI to reject non-compliant output regardless of which agent produced it

## Using both together

claude-flow manages _how agents are coordinated_; arbiter manages _what rules those agents must follow_. A claude-flow pipeline operating in a project governed by arbiter runs all agent output through the same gate checks and hook enforcement. The AGENTS.md arbiter generates is the governance contract claude-flow agents should consult.

---

_Last reviewed: 2026-08-26_
