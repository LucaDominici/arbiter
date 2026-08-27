---
title: 'arbiter vs spec-kit'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: []
related: []
---

# arbiter vs spec-kit

spec-kit is a spec-first requirements management tool. It generates structured specification documents from templates and keeps requirements traceable from design through implementation.

---

## What spec-kit does

- Generates specification documents from structured templates
- Tracks requirements with IDs, linking spec items to code
- Enforces that every feature has a written spec before implementation begins
- Provides traceability reports: which specs are implemented, which are pending

spec-kit is a **requirements discipline tool**. It governs the _planning_ phase of development.

## What arbiter does

arbiter is a **governance installer**. It governs the _execution_ phase: what the AI coding tool may write, how commits are shaped, and whether CI passes. It generates hook scripts, AGENTS.md invariants, and CI workflows — not specification documents.

---

## Feature comparison

| Capability                   | arbiter                | spec-kit |
| ---------------------------- | ---------------------- | -------- |
| Governance file (AGENTS.md)  | ✓                      | —        |
| Spec-driven requirements     | —                      | ✓        |
| AI tool hooks (blocking)     | ✓                      | —        |
| CI workflow generation       | ✓                      | —        |
| Requirements traceability    | ✓ (INV-112 / CANON-23) | ✓        |
| Idempotent project setup     | ✓                      | —        |
| Language-aware configuration | ✓                      | —        |

---

## When to choose spec-kit

- Your team needs structured, traceable requirements before writing any code
- You need to prove compliance: every feature maps to a written spec
- You are in a regulated domain where requirements traceability is mandatory
- Your bottleneck is requirements clarity, not code quality enforcement

## When to choose arbiter

- You need the AI coding tool to respect invariants _while writing code_, not just before
- You want CI to fail on governance violations automatically
- You are setting up a project for TypeScript, Rust, Java, Go, or Python and need consistent hooks, gate scripts, and AGENTS.md in under a minute
- You need GitHub infrastructure (branch protection, PR templates, labels) provisioned consistently

## Using both together

spec-kit and arbiter address different phases and can coexist. spec-kit governs what gets built; arbiter governs how it gets built. A team using spec-kit for requirements and arbiter for execution-phase governance gets coverage at both ends.

Arbiter's FEATURE_MATRIX and `scripts/check-feature-matrix.mjs` provide governed requirements
traceability, but arbiter does not yet create a durable specification artifact. It therefore does
not claim spec-driven development.

---

_Last reviewed: 2026-08-26_
