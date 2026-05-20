---
title: 'ADR-006: TypeScript + Node for the CLI runtime'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-006: TypeScript + Node for the CLI runtime

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Arbiter needs a CLI runtime for the `npx arbiter init` wizard and file generation. The question was which language and runtime to use.

## Decision

TypeScript + Node, distributed as `@arbiter/cli` on npm. Installed via `npx arbiter init`.

## Rationale

- **Zero install for JS/TS projects** -- `npx` works without a global install.
- **Target audience** -- most repos that would use arbiter already have Node in their dev environment.
- **EJS templating** -- mature, simple, well-typed for parameterized file generation.
- **Ecosystem fit** -- governance methodology originated in a TypeScript/Java shop.

### Alternatives rejected

- **Python** -- conflicts visually with ai-rulez (also Python). Independent projects but awkward positioning.
- **Rust** -- single binary, zero runtime deps. Rejected: compile time too long for an installer; worse DX for contributors.
- **Go** -- single binary. Rejected: same reasoning; smaller ecosystem for this specific task.

## Consequences

**Positive:**

- Familiar toolchain for the target audience (JS/TS developers).
- `npx` provides frictionless installation without global dependencies.
- Rich ecosystem for templating, CLI frameworks, and testing.

**Negative:**

- Requires Node.js in the dev environment (not available in some pure-Java or pure-Python shops).
- npm package publishing adds a release step compared to a single binary.
