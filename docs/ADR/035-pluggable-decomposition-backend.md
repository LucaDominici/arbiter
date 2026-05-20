---
title: 'ADR-035 — Pluggable Decomposition Backend'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-035 — Pluggable Decomposition Backend

**Status:** Accepted  
**Date:** 2026-05-05  
**Issue:** #408

---

## Context

Arbiter hard-coupled all task decomposition to GitHub (`gh issue`, `gh pr`, `gh label`).
Users on offline networks, NAS-hosted repos, or projects that don't use GitHub Issues
could not run the task lifecycle at all.

ADR-003 stated "GitHub required"; this decision supersedes that with a conditional:
GitHub is required **only when `decomposition.backend === "github"`**.

---

## Decision

Introduce a `DecompositionBackend` abstraction with two implementations:

| Id         | Class             | Storage                                  | Shell-out          |
| ---------- | ----------------- | ---------------------------------------- | ------------------ |
| `github`   | `GitHubBackend`   | GitHub Issues/PRs via `gh` CLI           | Yes (via `runCli`) |
| `markdown` | `MarkdownBackend` | `.arbiter/work/*.md` (YAML front-matter) | No                 |

Backend is selected by `arbiter.json`'s `decomposition.backend` field (added to `ArbiterConfigV2`).

The legacy `useGitHub` boolean is soft-aliased: when `decomposition.backend` is absent,
`useGitHub: true` maps to `github` and `false` maps to `markdown`. A one-time deprecation
warning is emitted via `stderr`. The alias is removed in a future minor release.

`arbiter init` gains a `--backend github|markdown` flag to override auto-detection
(default: `github` when `gh auth status` succeeds, else `markdown`).

---

## Consequences

**Good:**

- Offline / restricted-network users can run the full task lifecycle
- No `gh` dependency for markdown-mode users
- `task.md.ejs` conditional rendering keeps both backends in sync as the template evolves
- `DecompositionBackend` interface enables future backends (Linear, Jira, etc.) without touching consumers

**Neutral:**

- EJS template gains conditional blocks (5×3×2 = 30 matrix cells tested via CANON-13)
- `arbiter.json` schema bumps to include `decomposition` field (backwards-compatible)

**Bad / Accepted:**

- MarkdownBackend does not support cross-device sync out of the box (users must manage `.arbiter/` in git or via external tooling)
- GitHub-specific features (PR checks, auto-merge, labels) remain unavailable in markdown mode

---

## Alternatives Considered

**Hard-fork two separate CLI modes:** Rejected — doubles maintenance surface.

**Use environment variable to select backend:** Rejected — not auditable in `arbiter.json`.

**Defer markdown backend to a separate release:** Rejected — offline users blocked now.
