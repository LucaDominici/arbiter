---
title: 'ADR-003: gh CLI as required dependency for GitHub features'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-003: gh CLI as required dependency for GitHub features

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Arbiter needs to interact with GitHub for label provisioning, issue templates, and project setup. The question was how to authenticate and communicate with the GitHub API.

## Decision

`gh` CLI is required for GitHub features. If not authenticated, GitHub setup is skipped gracefully with a clear message.

## Rationale

- **Simpler security model** -- `gh` manages token storage, scopes, and rotation. Arbiter never handles GitHub tokens directly.
- **No token-in-wizard UX** -- terminals log commands; prompting for tokens is a security risk.
- **Consistent behavior** -- `gh` provides structured output and handles errors well.

### Alternatives rejected

- **GitHub token in wizard** -- security risk, poor UX.
- **GitHub MCP server** -- optional, not universally installed. **Rejected permanently in [ADR-020](020-cli-first-over-mcp.md)** — arbiter does not support MCP fallbacks for tool integrations.
- **HTTP directly with token from env** -- adds token management complexity to arbiter.

## Consequences

**Positive:**

- Zero token handling in arbiter code -- security responsibility delegated to `gh`.
- Graceful degradation: repos without `gh` still get all non-GitHub features.
- Familiar tool for developers already using GitHub.

**Negative:**

- Hard dependency on `gh` CLI for GitHub features (must be installed and authenticated).
- Users on GitHub Enterprise with non-standard auth may need extra `gh` configuration.
