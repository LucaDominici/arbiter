---
title: 'Recipes'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Recipes

Practical patterns for extending and adopting arbiter.

## Available recipes

| Recipe                                       | What it covers                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Add a custom invariant](./custom-invariant) | Write a `verifyPlanRules` entry via a plugin to enforce team-specific rules in `arbiter verify plan` |
| [Add a custom generator](./custom-generator) | Extend arbiter core with a new language or archetype (contributor path)                              |
| [Write an arbiter plugin](./plugin)          | Emit files and rules from a separate npm package — no arbiter fork needed                            |
| [Brownfield onboarding](./brownfield)        | Run `arbiter init` on an existing repo with conflict resolution and rollback                         |
