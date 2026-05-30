---
title: 'ADR-052: Fast-Forward Merge Policy and Cosign SHA Preservation'
doc_version: '1.0.0'
status: active
last_review: '2026-05-28'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: ['docs/ADR/051-merge-train-collaboration-mode.md']
---

# ADR-052 — Fast-Forward Merge Policy and Cosign SHA Preservation

**Status:** Accepted  
**Date:** 2026-05-28  
**Issue:** #1082  
**Invariant:** INV-101

---

## Context

GitHub offers three merge methods for pull requests: merge commit, squash merge, and rebase merge. Arbiter uses cosign keyless signing to bind attestations to a specific commit SHA. Only the merge-commit method preserves the original commit SHA end-to-end; squash and rebase-merge both rewrite commit history.

Additionally, arbiter-scaffolded projects use `required_linear_history: true` on the main branch, which enforces fast-forward-only merges at the GitHub API level. The combination of merge-commit method and `required_linear_history` means that only true fast-forward merges land on main — preserving the exact SHA that was signed.

### Why squash-merge is prohibited

Squash merge collapses N commits into a single new commit. The resulting SHA on main is different from any SHA the developer signed. Any cosign attestation bound to the pre-squash SHA is therefore unverifiable against the main branch state.

### Why rebase-merge is prohibited

Rebase merge replays commits with new timestamps and parent hashes, producing new SHAs. This is documented behavior: [codegenes.net — "verified signatures are gone after rebase-and-merge"](https://www.codegenes.net/blog/verified-signatures-are-gone-after-i-pressed-rebase-and-merge/). Cosign attestations on the original SHAs are invalidated.

### Why merge-commit with required_linear_history works

`required_linear_history: true` rejects non-fast-forward merges at the API level. Combined with `allow_squash_merge: false` and `allow_rebase_merge: false`, the only path to merge is a true fast-forward merge commit — where main advances to point at the exact SHA that was tested and signed.

### GitHub API topology

The merge method flags (`allow_squash_merge`, `allow_rebase_merge`, `allow_merge_commit`) live on `PATCH /repos/{owner}/{repo}`, not on the branch protection endpoint. `required_linear_history` lives on `PUT /repos/{owner}/{repo}/branches/main/protection`. Both calls are required; the `applyBranchProtection` function in `src/github/branch-protection.ts` and the generated `scripts/apply-branch-protection.mjs` both issue both calls.

`allow_merge_commit: true` is required even in ff-only mode because GitHub returns HTTP 422 if all three merge methods are disabled simultaneously.

---

## Decision

Enforce the following configuration on every arbiter-scaffolded project:

**Repo-level settings (PATCH /repos/{owner}/{repo}):**

- `allow_merge_commit: true` — the SHA-preserving merge path; required so GitHub does not error
- `allow_squash_merge: false` — prohibited; rewrites commit granularity
- `allow_rebase_merge: false` — prohibited; rewrites SHAs, invalidating cosign attestations

**Branch protection (PUT /repos/{owner}/{repo}/branches/main/protection):**

- `required_linear_history: true` — server-side ff-only enforcement
- `required_signatures: true` — L3+ only; enforces signed commits on main

**Cosign verify gate (ADR-052 verify step):**

- Added to `sign-and-attest/action.yml.ejs` composite action for `governanceLevel !== 'L1'`
- Added to `05-release.yml.ejs` `cosign-sign` job for `governanceLevel !== 'L1'`
- L1 excluded: L1 projects stay lightweight and avoid a hard dependency on sigstore.dev availability

**Invariant INV-101:**

- Enforced by `scripts/check-merge-method.mjs` at L1 gate
- Checks both `scripts/apply-branch-protection.mjs` (self-script) and `src/templates/scripts/apply-branch-protection.mjs.ejs` (EJS template) for the required flags
- Wired into `check-all.mjs` alongside INV-100

---

## Honest cost: rebase → re-sign cycle

The merge-train (ADR-051) rebases each worktree onto origin/main before merging. Rebase rewrites SHAs, which invalidates any pre-rebase cosign attestation. After rebase, the gate must re-run on the rewritten SHA, and a new cosign attest must be taken.

A merge-train of N worktrees runs sequentially:

```
for each worktree:
  1. git rebase origin/main  (~30s)
  2. node scripts/check-all.mjs gate  (~8-12 min)
  3. cosign sign-blob HEAD  (~30s)
  4. git merge --ff-only + push  (~10s)
```

For 5 worktrees: ~50 minutes wall time. The merge-train `--dry-run` flag prints the ETA so users opt into this cost knowingly.

This is a real cost, not a hidden one. The alternative (squash or rebase-merge via GitHub UI) would be faster but strips all cosign provenance from main — an unacceptable trade-off for projects using attestation chains.

---

## Merge queue trade-off

GitHub merge queues create `gh-readonly-queue/*` SHAs different from the feature branch tip. This is incompatible with "test exactly what lands" when SHA-stable signatures are required ([GitHub merge queue docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)). For `gated-review + cosign` mode, the generator emits ff-only + linear-history and disables the merge queue. Without cosign attestation requirements, merge queue is allowed.

---

## Alternatives considered

**Allow squash-merge, strip cosign attestations:** Faster CI UX, but attestation chain is broken. Rejected: cosign provenance is a first-class arbiter guarantee.

**Re-sign on merge (post-merge hook):** Could re-sign after the merge-commit lands on main. Rejected: post-merge signing cannot be fail-closed in a GitHub Actions context; if the signing step fails, a signed-but-unverified artifact is on main.

**Merge queue with re-test:** GitHub merge queue retests after re-base. Rejected for cosign mode: SHA changes again in the queue, requiring a third sign cycle. Allowed for non-cosign gated-review.

---

## Sources

- [About merge methods — GitHub Docs](https://docs.github.com/articles/about-merge-methods-on-github)
- [Verified signatures are gone after rebase-and-merge — codegenes.net](https://www.codegenes.net/blog/verified-signatures-are-gone-after-i-pressed-rebase-and-merge/)
- [Cosign keyless blob signing — sigstore](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/)
- [GitHub merge queue — docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Git signing your work — git-scm](https://git-scm.com/book/en/v2/Git-Tools-Signing-Your-Work)
