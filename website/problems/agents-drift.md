---
title: 'Our AI agents drift from the conventions we agreed on'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Our AI agents drift from the conventions we agreed on

> The agent knows our rules in the prompt, but a few turns later it reintroduces `any`, leaves bare TODOs, or edits files it shouldn't — prose guidance doesn't hold.

## The problem

An AI coding agent follows instructions probabilistically. Conventions stated in a system prompt or
CLAUDE.md are not binding — across a long session the agent drifts, and the violating edit lands
before a human notices.

## Who feels it

- Teams adopting Claude Code / Cursor / Copilot at scale.
- Leads who want agent output held to the same bar as human output.

## How arbiter enforces it

`arbiter init` generates **edit-time hooks** (Claude Code PreToolUse / PostToolUse) that hard-block a
violating edit the moment the agent makes it — not after the fact. Examples that ship always-active:

- **INV-04 (type safety):** a `check-no-any.mjs` PostToolUse hook rejects an edit that introduces
  `any` (TS) / the language equivalent; mirrored in the L1 lint gate.
- **INV-21 (no orphan TODOs):** `check-no-orphan-todo.mjs` blocks a bare `TODO` without a task ID.

The same invariants run in `scripts/check-all.mjs L1`, so even an edit made outside the hooked editor
is caught at commit. These are generated for every governance level (`alwaysActive`).

Source: invariant catalog (INV-04, INV-21, INV-24); [Enforcement Philosophy](/governance/); the
self-governance case study shows INV-04's hook firing in practice.

## How to verify

After `arbiter init`:

```bash
# Inspect the generated hook:
cat .claude/hooks/check-no-any.mjs
# Have the agent (or you) add an `any` cast — the PostToolUse hook rejects the write.
node scripts/check-all.mjs L1   # the same violation also fails the gate
```

## What it does NOT do

- It is **not a replacement for engineering judgment** — invariants are defaults your team owns and
  tunes; arbiter enforces what you chose, not a universal "correct".
- It **does not make your agent safe** in general — it only blocks the specific, configured
  invariants, not arbitrary undesirable behavior.

## Related

- [Standards documented but not enforced](/problems/enforced-not-advisory)
- [Can I trust the tool itself?](/problems/dogfooding-trust)
- [Concepts](/concepts/)
