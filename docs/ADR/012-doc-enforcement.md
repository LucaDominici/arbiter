---
title: 'ADR-012: 3-layer documentation enforcement'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '012'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-012: 3-layer documentation enforcement

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Code changes without corresponding documentation updates lead to documentation drift — a state where the source code and the documentation describe different systems. In an AI-governed project, this is especially problematic: AI agents read documentation to understand invariants, architecture, and conventions. Stale documentation produces wrong agent behavior.

Arbiter already had an advisory mechanism (`pre-edit-ssot-guard.mjs`) that warns when editing canonical governance files, but it exits 0 and cannot block a PR. There was no enforceable gate at the CI level, and no mechanism to propagate enforcement to projects that arbiter governs.

## Decision

Implement a 3-layer documentation enforcement mechanism:

| Layer | Mechanism                                   | Scope                                                                                      | Blocking?               |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| 1     | Claude hook: `pre-edit-ssot-guard.mjs`      | SSOT files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/METHOD/`, `docs/SYSTEM/DECISIONS`) | Advisory (exits 0)      |
| 2     | CI job: `docs-check` in GitHub Actions      | PRs that change `src/` or `__tests__/` without touching `docs/` or `README.md`             | Enforced (blocks merge) |
| 3     | Generated CI: `ci.yml.ejs` for L2+ projects | Same `docs-check` job generated for governed projects at L2 or L3                          | Enforced (blocks merge) |

**CI check logic (Layer 2 and 3):**

```
If any file changed in src/ OR __tests__/
AND no file changed in docs/ OR README.md
→ FAIL with message listing the code files changed
```

The check runs only on `pull_request` events (not on push to `main`), so direct-to-main merges — which are already blocked by branch protection — are not double-checked. On push events the job is skipped, and `ci-required` treats a skipped `docs-check` as passing.

**L1 exception:** Projects at governance level L1 (lightweight gate, pre-commit only) do not receive the `docs-check` job in their generated CI. The intent of L1 is minimal ceremony; forcing a docs touch on every code change is inconsistent with that.

## Rationale

**Why not enforce via `check-all.mjs` instead of CI?** The `check-all.mjs` gate is local and runs on the working tree. It cannot diff against a PR base — it would need to compare the current branch to `main`, which is fragile and fails on non-main-branched work. A GitHub Actions job has first-class access to `github.event.pull_request.base.sha`, making the diff reliable and cheap.

**Why not stricter (e.g., require a docs file for every commit)?** The unit of enforcement is the PR, not the commit. A developer can make multiple code commits in a PR and batch the documentation update at the end. Commit-level enforcement would require rebasing or amending, which creates unnecessary friction.

**Why `docs/` and `README.md` as the target?** These are the two locations where arbiter's own documentation lives. A PR that updates behavior in `src/` should explain the change in `docs/` (for architectural decisions, strategy, or reference) or in `README.md` (for user-facing changes). Other files (changelogs, test snapshots) are not considered documentation for this purpose.

**Why `skipIfExists` on the generated CI?** The generated `ci.yml` uses `skipIfExists`, so teams that have already customized their CI are not overwritten on re-init. They can pull the docs-check pattern from the template and add it manually, or run `arbiter update` to regenerate.

### Alternatives rejected

- **Always-blocking hook** — Hooks run in the user's editor session and cannot access PR context. A blocking hook on SSOT edits would prevent legitimate work (e.g., refactoring `src/` with a plan to add docs before the PR).
- **Require a `docs/CHANGELOG.md` entry per PR** — Changelogs become stale quickly and are often auto-generated. A weaker invariant (any docs touch) is more achievable and equally effective at preventing drift.
- **Lint the docs for broken links only** — Detects stale links but does not detect absent documentation for new features.

## Consequences

**Positive:**

- Every PR that changes code must touch documentation. Over time, documentation stays aligned with the codebase.
- The enforcement is visible in the PR checks list, creating a clear signal for reviewers.
- The same standard propagates to all L2+ projects governed by arbiter.

**Negative:**

- Minor refactors (e.g., renaming an internal variable) technically require a docs touch. In practice, teams can add a one-line note to `docs/` or `README.md` to satisfy the check. This is intentionally lightweight.
- The generated CI job uses `skipIfExists`, so existing governed projects receive it only after `arbiter update` or manual addition.
- The check does not verify the _quality_ of the docs update — a single whitespace change satisfies it. This is by design: the goal is to create the habit, not to audit content.
