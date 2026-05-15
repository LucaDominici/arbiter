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

arbiter is a **governance installer**. It produces a static set of governance artifacts — AGENTS.md, hook scripts, gate commands, CI workflows — that define the rules any agent (including Claude agents) must follow. arbiter is tool-agnostic: it supports Claude Code, Codex, Cursor, Windsurf, and others from a single install.

arbiter does not coordinate agents at runtime. It defines the rules that govern what those agents may produce.

---

## Feature comparison

| Capability                   | arbiter | claude-flow |
| ---------------------------- | ------- | ----------- |
| Multi-agent orchestration    | —       | ✓           |
| Parallel agent execution     | —       | ✓           |
| Shared agent memory/state    | —       | ✓           |
| Governance file (AGENTS.md)  | ✓       | —           |
| Blocking hook scripts        | ✓       | —           |
| CI workflow generation       | ✓       | —           |
| Multi-tool support (7 tools) | ✓       | —           |
| Language-aware setup         | ✓       | —           |
| npx install in one step      | ✓       | —           |

---

## When to choose claude-flow

- You need to coordinate many Claude agents working in parallel on a decomposed problem
- Your workflow involves large-scale autonomous task execution requiring shared state
- You are building Claude-native pipelines where agent coordination is the core challenge
- You need sophisticated memory and context management across agent instances

## When to choose arbiter

- You need governance rules enforced at the tool level — hooks that block violations before they land, not agent prompts that ask nicely
- You are working with multiple AI tools beyond Claude (Codex, Cursor, Windsurf) and need consistent governance across all of them
- You want a complete project governance setup (AGENTS.md + hooks + CI) in one install that works without an ongoing runtime
- You need CI to reject non-compliant output regardless of which agent produced it

## Using both together

claude-flow manages _how agents are coordinated_; arbiter manages _what rules those agents must follow_. A claude-flow pipeline operating in a project governed by arbiter runs all agent output through the same gate checks and hook enforcement. The AGENTS.md arbiter generates is the governance contract claude-flow agents should consult.

---

_Last reviewed: 2026-05-15_
