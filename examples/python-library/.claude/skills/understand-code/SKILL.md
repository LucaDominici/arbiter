---
name: understand-code
description: Use when exploring an unfamiliar code path, tracing a feature end-to-end, or when asked "how does X work?". Structured 4-step comprehension protocol. READ-ONLY.
argument-hint: "<module, path, or feature description>"
title: "Understand Code"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Understand Code

**Mode:** READ-ONLY throughout. No edits during this skill.

## Step 1: Scope Discovery

Use Glob and Grep to locate relevant files:

```
Glob: src/**/*<keyword>*
Grep: "<keyword>" in src/
```

Collect:
- Entry point (controller, command, route handler, event listener)
- Domain / business logic files
- Adapter files (repository, HTTP client, external service)
- Test files (unit + integration)

## Step 2: Code Tracing

Read files in dependency order:
1. Entry point — what triggers this code path?
2. Application layer — what orchestration happens?
3. Domain — what business rules apply?
4. Adapters — how does the system persist or call out?

Limit: Read at most 8 files. If scope is larger, narrow the argument.

## Step 3: Contract Mapping

For each function in the call chain, note:
- Pre-conditions (what must be true before the call)
- Post-conditions (what is guaranteed after)
- Error paths (what can go wrong)

## Step 4: Summary Report

```markdown
## Code Understanding: <argument>

**Entry Point:** <file:line — method/endpoint/event>

**Call Chain:**
  <Layer1> → <Layer2> → <Layer3>

**Key Data Flow:**
  1. <input> received at <layer>
  2. <transformation or validation>
  3. <persistence/response>

**Domain Rules:**
  - <rule 1>

**Test Coverage:**
  - Unit: <files or "none found">
  - Integration: <files or "none found">

**Gaps / Risks (observe only — do not fix here):**
  - <gap 1>

**Next Step:**
  - <if debugging>: hypothesis to test first
  - <if modifying>: safe entry point for edits
```

## Constraints

- Read-only. Do not edit files.
- Do not propose fixes — only document gaps.
- Do not run tests or gate.
