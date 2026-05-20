---
title: 'What arbiter Is NOT'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# What arbiter Is NOT

**Issue:** #667

This page cuts through common misconceptions before they take root.

---

## arbiter is not an AI

arbiter is a CLI tool that generates governance configs for AI coding agents. It does not contain, host, or interface with any AI model. It does not make decisions, write code, or review your work. It generates the rules and enforcement infrastructure that constrain how AI agents work in your project.

## arbiter is not a replacement for engineering judgment

The invariants in arbiter are defaults based on common patterns. Your team must review, extend, and own them. A misconfigured invariant that passes bad code is worse than no invariant. arbiter gives you a starting point; judgment and iteration are required.

## arbiter is not a silver bullet for legacy debt

If your codebase has significant existing violations, arbiter will detect them and your gate will fail. The intended workflow is: audit existing violations → add suppression baselines → enforce going forward. arbiter does not magically fix what is already broken.

## arbiter is not a compliance certification

Generating arbiter configs and passing the gate does not certify compliance with ISO 27001, SOC 2, GDPR, or any other standard. arbiter can generate configs that map to those standards, but certification requires audit, evidence collection, and third-party review that arbiter does not provide.

## arbiter is not a CI replacement

arbiter generates configs that integrate with your CI system. It does not replace CI. Your build, test, deployment, and release pipelines are separate concerns. arbiter's gate is one step in a pipeline, not a full pipeline.

## arbiter is not free of trade-offs

arbiter adds overhead:

- Hooks add latency to every file edit.
- Gate checks add time to PRs.
- Governance rules reduce autonomy.

These trade-offs are intentional. If velocity is the only constraint, governance tooling is the wrong choice. arbiter is for teams that have decided governance consistency is worth the overhead.

## arbiter does not guarantee your AI agent will be safe

arbiter constrains the agent's behavior within your project. It does not prevent the agent from making mistakes, hallucinating, introducing subtle logic bugs, or bypassing governance in ways not covered by the configured invariants. Defense in depth still applies.

## arbiter does not collect or sell data

Zero telemetry. See [PRIVACY.md](../../PRIVACY.md).

---

_For the affirmative case — what arbiter does do — see the [README](../../README.md)._  
_For positioning rationale, see [POSITIONING.md](../POSITIONING.md)._
