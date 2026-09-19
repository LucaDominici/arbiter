---
title: 'Execution Protocol'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Execution Protocol

Before editing, confirm the task branch and read the active plan. Use the `/ship`
entrypoint for delivery. Keep checkpoint evidence intact and record red-test
evidence before advancing a TDD phase.

If a gate fails, stop after two focused attempts and report the actual blocker;
never bypass it or suppress an orphan TODO. Checkpoint commits may capture staged
work cheaply; reserve the full gate for the final candidate.
