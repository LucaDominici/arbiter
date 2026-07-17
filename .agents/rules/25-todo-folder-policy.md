---
title: 'TODO Policy'
doc_version: '1.0.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# TODO Policy

- Every TODO comment in source code MUST reference a task ID: `TODO(#NNN): description`
- Bare `TODO` or `TODO: description` without a task ID is a gate violation (INV-21)
- Enforced by the `check-no-orphan-todo.mjs` post-edit hook
