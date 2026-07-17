---
title: 'Incidental-Capture Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Incidental-Capture Rule

While doing task X, you will notice debt, smells, and risks that live OUTSIDE X's
scope. Each one is real and must not be lost — but acting on it inside X corrupts
the diff, dilutes the review, and breaks the one-task-one-change contract.

## The Contract

When you notice an out-of-scope finding while working task X, your ONLY in-band
action is to capture it:

```bash
arbiter note "<finding>" --kind <dup|smell|risk|debt> --severity <low|med|high> --file <path> --line <n>
```

Capture is the TERMINAL action for that finding during this task. Once noted, you
return to X immediately.

## Hard Stops

For a finding that is out of scope for the current task, do NOT:

- Fix it (no edit to address it — capture only)
- Branch for it or widen the current task's diff to accommodate it
- Open an issue inline, refactor "while you're here", or chase it down a rabbit hole

The note lands in a per-agent JSONL spool at `.arbiter/findings/<shard>.jsonl`
(ephemeral, gitignored — drained downstream, never committed).

## Composes With

- **Root-cause discipline** — a smell INSIDE the current diff is fixed or recorded
  as tech-debt, not merely noted. `arbiter note` is for findings OUTSIDE the current
  diff.
- **Tech-debt** — a finding that warrants a tracked, durable follow-up is promoted
  to `arbiter task record-tech-debt`; `arbiter note` is the lightweight first capture,
  drained and triaged later.

## Why

A noticed-but-unrecorded finding is a finding lost. Separating "see it" from "fix
it" keeps each task's diff minimal and reviewable, prevents scope creep, and turns
every passing observation into durable signal instead of an abandoned good intention.
