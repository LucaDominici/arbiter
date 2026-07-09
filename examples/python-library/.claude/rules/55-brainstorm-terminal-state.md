---
title: 'Brainstorm Terminal-State Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-06-07'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Brainstorm Terminal-State Rule

Brainstorming is a divergence phase, not an implementation phase. Its output is a
decision, captured durably — never code.

## The Contract

A brainstorm session has exactly one terminal state:

1. A committed design doc under `.arbiter/design/<topic-slug>.md`, and
2. A GitHub issue that captures the decision.

Once both exist, the session **STOPS**. It never flows into implementation in the
same turn.

## Hard Stops

While a brainstorm is active (marker `.arbiter/brainstorm-active` present), do NOT:

- Begin implementation or edit source files
- Create branches or commits for the feature
- Run `/task` to advance into build

The `post-brainstorm-stop` hook enforces this: it blocks `/task` until the marker
is explicitly cleared (`rm .arbiter/brainstorm-active`) or the marker auto-expires
after 24 hours.

## Why

Separating "decide what to build" from "build it" keeps decisions reviewable before
code is written, prevents half-explored designs from hardening into the codebase,
and gives every implementation a tracked issue to anchor against. Implementation
begins only after a human picks up the issue with `/task #<issue-number>`.
