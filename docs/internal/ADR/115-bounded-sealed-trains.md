---
title: 'ADR-115: Bounded Sealed Trains — When a Batch Stops Taking Issues'
doc_version: '1.0.0'
status: active
last_review: '2026-08-22'
owner: ''
canonical_id: '115'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/ADR/051-collaboration-mode-workflow-axis.md',
    'docs/internal/ADR/108-ff-only-merge-method-evidence-bearing-prs.md',
    'docs/methodology/gate-throughput-patterns.md',
  ]
---

# ADR-115: Bounded Sealed Trains — When a Batch Stops Taking Issues

**Project:** arbiter
**Date:** 2026-08-22
**Status:** Accepted

## Context

`.arbiter/gate-pass.json` binds to an exact HEAD, so any commit after a gate invalidates it.
N issues therefore cost N full gate cycles and N PRs, even when the work shares one worktree
and was never parallel. That arithmetic is the entire economic case for batching.

`--chain` (#2102) already provides the mechanism: one worktree / one branch / N commits / one
gate / one PR, enforced by `.githooks/pre-push`, which blocks a push unless every id in
`[taskId, ...chainIds]` has a commit subject naming it.

Two gaps remained.

**The batch had to be declared up front.** `--chain` replaces `chainIds` wholesale
(`seedShipState` shallow-merges the document), so the operator must know the entire batch before
starting the first issue — precisely when they know least. There was no way to finish an issue,
recognise that the next one belongs on the same branch, and add it.

**Nothing said when to stop.** An unbounded batch is not a train; it is a long-lived branch, which
is the failure mode batching is supposed to avoid. Every issue added widens the diff a single gate
result has to vouch for, and delays every issue already on board.

## Decision

`--chain` remains the entry point and the declared-batch form. A bounded accumulate-and-seal layer
is added on top.

### `--chain-add <id>` appends; the seal decision lives in the same call

`arbiter ship <id> --chain-add <id>` appends to `chainIds` instead of replacing them. If a stop
condition holds, the append is **refused** with `SEALED: <reason> — <detail>`, and the operator
lands the train rather than growing it. One command, one decision, fail-closed — not a subsystem.

`applyChainAdd` runs **before** the document is seeded, so a refused append leaves state
byte-identical. A sealed train never half-applies.

### The four stop conditions

| Reason      | Condition                                        | Default          |
| ----------- | ------------------------------------------------ | ---------------- |
| `explicit`  | `--seal`                                         | —                |
| `risk`      | the appended issue widens to tier `Standard`     | seal immediately |
| `max-chain` | ids on the branch, primary included              | 4                |
| `max-age`   | age of the open train (`timestamps.chainOpened`) | 240 min          |

Precedence is by strength of reason, not cost of check: an operator who hits both a risk boundary
and the size limit needs to be told about the risk.

**Every signal must be evaluable before the appended issue has a diff**, because that is when the
decision is made. Risk therefore reads from `gatherTierSignals` — issue labels, milestone bundle,
graph blast-radius — and never from `REVIEW_AGENTS_SECURITY_SURFACE`, which is file-path-matched
against a diff and cannot fire yet. The appended issue is widened from `XS` rather than from the
train's current tier, so it is judged on its own risk instead of inheriting the train's.

The 240-minute budget matches `ARBITER_PREPUSH_MAX_AGE_MIN`, so a train cannot outlive the gate
evidence it is accumulating toward.

**Fail-safe on age:** a missing or unparseable `chainOpened` reads as _fresh_, never as infinitely
old. The opposite default would turn one corrupt timestamp into a train that can never accept
another issue, and the failure would look like policy rather than corruption.

### Every issue on a chain owes RED evidence

`checkTddEvidenceGate` verified exactly one task id, so a chain of N landed with N−1 issues having
nothing assert that a test failed for them first. The sweep now covers `[taskId, ...chainIds]` and
is the evidence peer of the per-id commit-subject scan pre-push already performs.

It runs at `verification`, **not** at `green`. A chain traverses the phase machine once — a single
`phase` cursor, forward-only advance — so at `green` only the primary issue is implemented and its
evidence is the only evidence that can exist. Requiring the whole chain there would deadlock every
train at its first issue. It reports every missing id at once, because an operator repairing a
train wants the list, not one failure per re-run.

## Alternatives rejected

**Compute which issues belong together.** #1817 deleted `src/affinity/` and its siblings, moving
auto-computation to guidance. Reintroducing a scorer — in any language, in any file — is that same
decision reversed, and would need its own ADR rather than arriving as part of a batching change.
Which issues share a train stays a model judgement; only the _bound_ is mechanical. The knob left
behind by that prune is tracked separately (#2329).

**Per-repo configuration of the bounds.** Rejected as speculative. `--chain-add` is opt-in, so no
repository begins batching without asking, and collaboration-mode defaults would guard a risk the
flag's absence already guards. `DEFAULT_TRAIN_LIMITS` is exported, so a future resolver can feed
`evaluateSeal` without touching the policy.

**Changing merge detection for train branches.** Under ADR-108 ff-only landing,
`git merge-base --is-ancestor` (`src/worktree/validate.ts`) is correct. The patch-id hazard that
makes ancestry tests unreliable belongs to squash and rebase merges, which are not evidence-bearing
landing paths here.

## Consequences

- A train carries at most 4 issues and lives at most 4 hours before it must be landed.
- A risk-bearing issue always rides its own train.
- `--chain` behaviour is unchanged; a ship with neither flag is byte-identical to before.
- The per-issue evidence requirement applies to chains created by `--chain` as well, closing a hole
  that predates this ADR.
