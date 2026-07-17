---
title: 'ADR-108: Merge method = fast-forward-only for evidence-bearing PRs'
doc_version: '1.0.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: '108'
tags: ['audience/dev', 'kind/adr']
related: ['052-fast-forward-merge-cosign-preservation']
---

# ADR-108: Merge method = fast-forward-only for evidence-bearing PRs

**Project:** arbiter
**Date:** 2026-07-17
**Status:** Accepted
**Issue:** #1969 (closed)

## Context

Issue #1969 asked whether wave/task branches carrying TDD RED-phase evidence SHAs should
merge via GitHub's squash button, rebase button, or fast-forward. ADR-052 already mandates
merge-commit + `required_linear_history` (fast-forward-only) repo-wide, keyed to cosign SHA
preservation. #1969 confirms the same policy also governs evidence-bearing PRs specifically,
for a second, independent reason: TDD RED SHAs recorded during a task must remain reachable
from `main` after merge so evidence tooling (`check-evidence-bundle.mjs`,
`check-tdd-evidence`) can walk the commit graph back to them. Squash merge collapses those
commits into one new SHA, breaking reachability; rebase merge replays them with new SHAs,
same effect.

## Decision

Squash merge stays disabled repo-wide. Wave and task branches merge by fast-forward-push of
the branch tip, so TDD RED-phase SHAs remain reachable from `main`. GitHub's rebase-merge
button is reserved for evidence-free PRs only (e.g. routine dependency bumps) where no RED
SHA needs to survive the merge.

This is a confirmation and a named second rationale for the existing ADR-052 mechanism, not
a change to it — ADR-052's merge-commit + `required_linear_history` configuration is
unaffected.

## Consequences

- No configuration change: ADR-052's branch-protection settings already enforce this.
- Evidence tooling can assume TDD RED SHAs are reachable from `main` post-merge without an
  additional check.
- Rebase-merge remains available for the narrow evidence-free case; squash-merge remains
  fully disabled.
