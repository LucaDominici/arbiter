---
name: brainstorming
description: Structured brainstorming skill — explore solution space, produce design doc and GH issue, then STOP. No auto-implementation.
argument-hint: '[topic or problem description]'
title: 'Brainstorming Skill'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Brainstorming Skill

Activate when the user asks to brainstorm, explore options, think through a design, or gather ideas before implementation.

## Entry

When this skill is invoked:

1. Write `.arbiter/brainstorm-active` to signal an active brainstorm session:
   ```bash
   mkdir -p .arbiter && touch .arbiter/brainstorm-active
   ```
2. Proceed to the brainstorming process below.

## Process

### Step 1 — Frame the problem

Restate the problem in one sentence. Identify constraints, non-goals, and success criteria.

### Step 2 — Generate options (minimum 3)

For each option:

- **Name**: a short label
- **Approach**: 2–4 sentences
- **Tradeoffs**: pros and cons relative to the others
- **Fit**: how well it satisfies the constraints

### Step 3 — Recommend

State your recommended option and the primary reason. Note any conditions that would make a different option preferable.

### Step 4 — Design doc

Write a short design document covering:

- Problem statement
- Chosen approach
- Key decisions and rejected alternatives
- Open questions

Save to `.arbiter/design/<topic-slug>.md`.

### Step 5 — Create GitHub issue

Create a GH issue capturing the design decision:

```bash
gh issue create --title "design: <topic-slug>" --body "$(cat .arbiter/design/<topic-slug>.md)"
```

## Terminal State (MANDATORY)

**STOP after Step 5.** Do NOT:

- Begin implementation
- Edit source files
- Create branches or commits
- Run `/task`

The brainstorm session ends when the design doc exists and the issue is created. Implementation begins only after the user explicitly clears the marker:

```bash
rm .arbiter/brainstorm-active
```

Until the marker is cleared, the `post-brainstorm-stop` hook blocks `/task` commands with an error citing this file path.

## Exit

After the user clears the marker (or it auto-expires after 24h), the session is ready for `/task #<issue-number>` to begin implementation.
