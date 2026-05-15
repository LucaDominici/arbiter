# arbiter vs GSD2

GSD2 (Get Stuff Done v2) is an autonomous task execution framework. It breaks down user goals into sub-tasks, assigns them to specialized agents, and drives execution loops until completion — with minimal human intervention at each step.

---

## What GSD2 does

- Decomposes high-level goals into executable sub-tasks automatically
- Dispatches sub-tasks to specialized agents (coder, reviewer, tester, deployer)
- Drives iterative execution loops, retrying and adapting on failure
- Supports multi-tool agent composition across a single workflow

GSD2 is an **autonomous execution engine**. Its primary value is reducing the number of human hand-off points in complex AI-driven workflows.

## What arbiter does

arbiter is a **governance installer**. It does not orchestrate tasks or drive execution. It sets up the static artifacts that constrain execution: AGENTS.md invariants, hook scripts, gate commands, and CI workflows. Once installed, arbiter's artifacts are enforced by the tools already running (Claude Code hooks, CI runners) — not by arbiter itself at runtime.

---

## Feature comparison

| Capability                    | arbiter | GSD2 |
| ----------------------------- | ------- | ---- |
| Autonomous task execution     | —       | ✓    |
| Multi-agent sub-task dispatch | —       | ✓    |
| Governance file (AGENTS.md)   | ✓       | —    |
| Blocking hook scripts         | ✓       | —    |
| CI workflow generation        | ✓       | —    |
| Multi-tool support (7 tools)  | ✓       | ✓    |
| Language-aware setup          | ✓       | —    |
| Zero telemetry guarantee      | ✓       | —    |

---

## When to choose GSD2

- You want an AI system that drives multi-step tasks from goal to completion with minimal human check-ins
- Your bottleneck is the number of human hand-offs, not rule enforcement
- You need agents that adapt and retry autonomously when sub-tasks fail
- You are running complex pipelines where coordination overhead dominates

## When to choose arbiter

- You want the rules of your project enforced mechanically — not left to agent judgment on each run
- You need the same governance invariants to apply regardless of which agent or tool is executing
- You want a single `npx arbiter init` to produce a complete, language-aware governance setup
- You need CI to fail (not warn) when governance rules are violated

## Using both together

GSD2 handles _what gets done and how tasks are orchestrated_; arbiter handles _what rules apply during execution_. arbiter's AGENTS.md serves as the governance contract that GSD2's execution agents must respect. Running GSD2 in a project governed by arbiter means every agent's output passes through the same hook and gate checks.

---

_Last reviewed: 2026-05-15_
