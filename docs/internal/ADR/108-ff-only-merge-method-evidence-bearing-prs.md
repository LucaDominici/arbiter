---
title: 'ADR-108: Exact-SHA landing for evidence-bearing PRs'
doc_version: '2.0.0'
status: active
last_review: '2026-07-27'
owner: ''
canonical_id: '108'
tags: ['audience/dev', 'kind/adr']
related: ['052-fast-forward-merge-cosign-preservation']
---

# ADR-108: Exact-SHA landing for evidence-bearing PRs

**Project:** arbiter
**Status:** Accepted
**Issue:** #1969, corrected by #2148

## Context

TDD evidence records RED and GREEN commit SHAs. Squash and rebase merge destroy their
reachability; a merge commit preserves reachability but makes `main` point to a different,
untested SHA. ADR-052's former merge-commit/linear-history explanation was empirically
falsified by #2147 and is replaced by an atomic ref compare-and-swap.

## Decision

Every evidence-bearing `trunk-solo + pr-ff` landing atomically advances `main` from the
observed base to the exact gated head with `force:false`. The same mutation asserts that the
task ref still equals the gated head. Success requires:

- all required checks green;
- unchanged base and head snapshots;
- live settings matching the canonical exact-SHA policy;
- GitHub reporting the PR `MERGED`;
- post-read `main == gatedHeadSha`;
- recorded RED and GREEN SHAs reachable from `main`.

No GitHub squash, rebase or merge-commit endpoint is an evidence-bearing landing path.
The former “rebase is allowed for evidence-free PRs” exception is removed because it
conflicted with repository-wide commit-identity guarantees.

## Consequences

- `required_linear_history` is disabled; atomic non-force CAS enforces the stronger property.
- A stale base or moved head rejects the whole mutation without changing `main`.
- Local rebases are allowed only before regenerating the final evidence and gate.
- Peer/gated exact-SHA landing needs a trusted updater/review-bypass design and is not silently
  treated as equivalent to the trunk-solo path.
