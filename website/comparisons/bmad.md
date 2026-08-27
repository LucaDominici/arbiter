---
title: 'arbiter vs BMAD'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: []
related: []
---

# arbiter vs BMAD

BMAD (Business Methodology for AI Development) is a persona-driven workflow framework. It structures AI-assisted development around specialized agent roles — architect, developer, analyst, QA — each with defined responsibilities and hand-off protocols.

---

## What BMAD does

- Defines named agent personas (architect, dev, QA, PM, and others) with explicit role boundaries
- Provides structured prompts and templates for each persona
- Orchestrates multi-agent workflows with defined hand-off points
- Focuses on _how the AI thinks_ about a task given its assigned role

BMAD is a **workflow orchestration framework**. Its primary value is structured, role-based AI behavior across a project lifecycle.

## What arbiter does

arbiter is a **governance installer**. It generates the files and enforcement mechanisms that constrain what any AI tool may write — hook scripts that block invariant violations, gate commands that fail on coverage or lint errors, and AGENTS.md that documents the rules in a machine-readable format.

arbiter does not define agent roles or workflow phases. It defines the _rules that apply regardless of which phase or role is active_.

---

## Feature comparison

| Capability                     | arbiter | BMAD |
| ------------------------------ | ------- | ---- |
| Agent persona definitions      | —       | ✓    |
| Multi-agent workflow structure | —       | ✓    |
| Governance file (AGENTS.md)    | ✓       | —    |
| Blocking hook scripts          | ✓       | —    |
| CI workflow generation         | ✓       | —    |
| Language-aware setup           | ✓       | —    |
| npx install in one step        | ✓       | —    |
| Zero telemetry guarantee       | ✓       | —    |

---

## When to choose BMAD

- You want structured, persona-driven creative workflows (architecture → design → implementation → QA)
- Your team benefits from explicit role separation and hand-off discipline between AI agents
- You are running complex, multi-phase projects where task orchestration across roles is the primary concern
- You do not need mechanical enforcement — your discipline is workflow, not gate failures

## When to choose arbiter

- You need the AI tool to be _blocked_ from writing `any` types, `.unwrap()` calls, or orphan TODOs — not just asked not to
- You want CI to fail hard on governance violations, not warn
- You need a consistent, language-specific AGENTS.md with matching hooks deployed in under a minute
- You are working with multiple AI tools (Claude Code and Codex out of the box; Cursor and others experimental) and need unified governance across all of them from one install

## Using both together

BMAD governs _workflow_; arbiter governs _rules_. A project can use BMAD personas to orchestrate phases and arbiter to enforce the invariants those personas must respect. arbiter's AGENTS.md is designed to be the governance contract that any agent persona operates under.

---

_Last reviewed: 2026-08-26_
