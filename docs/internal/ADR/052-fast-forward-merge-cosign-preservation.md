---
title: 'ADR-052: Exact-SHA Landing and Cosign Preservation'
doc_version: '2.1.0'
status: active
last_review: '2026-09-04'
owner: ''
canonical_id: '052'
tags: ['audience/dev', 'kind/adr']
related: ['docs/internal/ADR/051-collaboration-mode-workflow-axis.md']
enforces: ['INV-101']
---

# ADR-052 — Exact-SHA Landing and Cosign Preservation

**Status:** Accepted
**Issue:** #1082, corrected by #2148, made mode-aware by #2150
**Invariant:** INV-101

## Context

Squash and rebase merge create new commit identities. A merge commit preserves the task
commits as ancestors, but creates a different `main` tip. None of GitHub's PR merge methods
therefore implements the stronger contract `main == gatedHeadSha`.

The previous revision incorrectly claimed that `allow_merge_commit:true` plus
`required_linear_history:true` produced a true fast-forward. The GitHub API disproved that
claim: with linear history enabled, disabling both squash and rebase is rejected with HTTP 422. PR #2147 then exposed the false green in production: gated head
`231ad2ed13758a6607e58849562bacd9da985a8d` was merged through rebase and landed as
`d228efb6bce48e004c9fc8a57a107cefa935d4ac`. The gated SHA is not an ancestor of the landed
SHA. That historical evidence is recorded as `preservation: LOST`; `main` must not be
force-pushed to conceal it.

## Decision

For `trunk-solo + pr-ff`, the PR is the review/check carrier only. Arbiter never calls the
GitHub PR merge endpoint. After checks are green, `scripts/pr-merge-watch.mjs` uses GraphQL
`updateRefs` to atomically:

1. compare-and-swap `refs/heads/main` from the observed base SHA to the exact gated head SHA;
2. assert the task ref still points to that head with a no-op update;
3. set `force:false` on both updates;
4. post-verify that GitHub reports the PR merged and `main` equals the gated head.

GitHub documents `updateRefs` as atomic: if any `beforeOid` assertion is rejected, no ref is
updated. This makes base/head drift fail closed rather than silently rebasing or retrying
against new state.

The canonical executable compatibility policy is
`scripts/lib/exact-sha-policy.mjs`:

- `allow_merge_commit:true` — required because GitHub requires at least one PR merge method;
  it is a compatibility escape, not an Arbiter landing primitive;
- `allow_squash_merge:false`;
- `allow_rebase_merge:false`;
- `required_linear_history:false` — necessary for the repo setting tuple to be accepted;
- `allow_force_pushes:false`;
- `allow_deletions:false`.

Linearity and identity are enforced by the atomic non-force CAS, not by the misleading
`required_linear_history` flag. A dedicated GitHub App would be required to remove the
remaining manual merge-button/admin bypass completely; until then, the watcher, `/ship`,
live-policy check and L1 wiring gate prohibit that path.

### Mode-aware landing contract (#2150)

The CAS above is confined to `trunk-solo`. The other two collaboration modes are **declared
and refused**, not omitted — an absent arc reads as "never considered", an unsupported arc
reads as "known, refused and tracked". `LANDING_CONTRACT` and `resolveLandingContract()` in
`scripts/lib/exact-sha-policy.mjs` are the single source of that decision; the watcher, the
branch-protection applicator and the `/ship` merge step read the arc instead of each
re-deciding from a `collaborationMode` literal.

| `collaborationMode` | `supported` | `requiresTrustedUpdater` | `blockedOn` | landing | `main == gatedHeadSha` |
| ------------------- | ----------- | ------------------------ | ----------- | ------- | ---------------------- |
| `trunk-solo` (+ `solo.mergeMode: pr-ff`) | `true` | `false` | — | atomic non-force `updateRefs` CAS | **yes** |
| `peer-review` | `false` | `true` | #2289 | GitHub PR merge (merge commit) | no — `main` gets a new tip |
| `gated-review` | `false` | `true` | #2289 | GitHub PR merge (merge commit / merge queue) | no — `main` gets a new tip |

An **unknown**, **absent** or **malformed** `collaborationMode` resolves to *refused*, never
to a default arc: on a merge trust boundary an ambiguity resolves toward refusing. The
watcher evaluates the arc before its first `gh` invocation, so an unsupported mode reads
nothing about the repository at all.

### Deferred to #2289 — trusted updater (GitHub App)

Absent here and tracked, never stubbed: a GitHub App as the only actor authorised to advance
`main`; removing or fail-closing the manual merge-button / admin path; the review branch
(`reviewDecision === 'APPROVED'`, which `trunk-solo` has no second approver for and which
would weaken the delivered path if wired now); and the **live** tests for the non-solo modes
(missing approval = RED, missing check = RED, SHA drift = RED, happy path
`main == gatedHeadSha`). A skipped or auto-green test on an unimplemented trust boundary is a
false declaration of safety, so none was written. #2289 is blocked only on the owner creating
the App and is actionable the moment it exists.

## Enforcement

- `scripts/check-merge-method.mjs` fails closed unless policy, applicator and watcher are
  present, connected, non-forced, and free of squash/rebase PR merge calls.
- `pr-merge-watch.mjs` validates live repository and branch-protection settings immediately
  before mutation.
- `scripts/apply-branch-protection.mjs` imports the same executable policy as the watcher.
- `src/templates/claude/commands/ship.md.ejs` routes `trunk-solo + pr-ff` through the watcher,
  and its `peer-review` / `gated-review` arc declares openly that there `main != gatedHeadSha`.
- `pr-merge-watch.mjs` resolves the landing arc through `resolveLandingContract()` before its
  first GitHub call; the refusal for every unsupported/unknown/absent/malformed mode is
  asserted mode by mode in `__tests__/scripts/pr-merge-watch-promotion.test.ts`.
- Tests exercise successful atomic promotion, stale base/head, live drift, policy wiring and
  post-merge SHA equality.

## Rebase before evidence

A local rebase is allowed only before the final gate. It changes the SHA, so RED/GREEN
evidence and attestations must be regenerated against the rebased head. Rebase after the
gate, including GitHub's rebase-merge method, is prohibited.

## Alternatives

- **Squash/rebase PR merge:** rejected; rewrites evidence-bearing SHAs.
- **Merge commit:** rejected for exact-SHA landing; `main` would have a new, untested tip.
- **REST ref update after a pre-read:** rejected; it lacks an explicit base `beforeOid` CAS
  and cannot atomically assert that the task ref stayed fixed.
- **Force push repair of #2147:** rejected; destructive and would falsify the incident record.

## Sources

- [GitHub GraphQL `updateRefs`](https://docs.github.com/en/graphql/reference/mutations#updaterefs)
- [GitHub merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)
- [Cosign keyless blob signing](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/)
