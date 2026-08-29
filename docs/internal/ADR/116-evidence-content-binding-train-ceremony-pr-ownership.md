---
title: 'ADR-116: Evidence Binds to Source Content; the Train Is the Ceremony Unit; a PR Is Owned Until Merged'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: '116'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/ADR/108-ff-only-merge-method-evidence-bearing-prs.md',
    'docs/internal/ADR/115-bounded-sealed-trains.md',
    'docs/methodology/gate-throughput-patterns.md',
  ]
---

# ADR-116: Evidence Binds to Source Content; the Train Is the Ceremony Unit; a PR Is Owned Until Merged

**Project:** arbiter
**Date:** 2026-08-29
**Status:** Accepted

## Context

`.arbiter/evidence/kpi/2026-08-29.json` measured what the ceremony actually cost over one
48-hour window: one 5-issue train took 22.7h and 67 commits to land, 8 of them pure
evidence-SHA-bump commits and 26 review-loop commits chasing a re-review that restarted from
scratch each time. A separate PR was opened with CI already red and left stale — nobody was
driving it, because nothing forced a PR to have an owner until it merged. Six failures sit
under that number:

- **Exact-HEAD evidence binding.** `sha === HEAD` on review evidence meant every commit that
  wrote the evidence artifact invalidated the evidence it had just recorded — the loop that
  produced the 8 sha-bump commits.
- **No batching unit.** The playbook ran the full per-issue ceremony (plan, plan-review,
  red-team, code review, cross-model seat, gate, PR) for every issue, three-line fixes
  included, with no config default for batch size or lifetime.
- **Unbounded review rounds.** A refactor phase with no round cap re-reviewed the whole diff
  after every fix; every full re-review found something new — most of the 26 review-loop
  commits.
- **Branch-blind dispatch sidecar.** `.arbiter/agents-dispatched.json` is one tracked file
  shared by every branch, so a sidecar entry from a different task's dispatch read as
  evidence for the current one.
- **Hooks blocked their own playbook.** `stop-dangerous` matched a destructive-looking word
  anywhere in the raw command text, blocking `gh issue create --body "...rm .arbiter/..."`
  and the ship playbook's own sanctioned `node -e` evidence writers. `pre-spawn-worktree-guard`
  wedged a 2-hour dispatch slot even when the spawn it guarded was rejected.
- **The Codex bridge matched nothing.** Codex sends `tool_name: "Bash"` (capital B); every
  bash-side hook's `^bash$` matcher silently matched zero calls under Codex, so
  stop-dangerous, enforce-gate-before-pr, closer-mode-guard and post-commit-check were inert
  on that track.

## Decision

| Rule                                                   | Mechanism                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence binds to content                              | `scripts/lib/evidence-binding.mjs`: valid iff the sha resolves, is an ancestor of HEAD, and nothing outside `.arbiter`/`.agents` changed between that sha and HEAD (plus a branch check when required). Committed range only. `gate-pass.json` stays exact-HEAD by design (TTL-bound, regenerated every run — no refresh loop to solve). |
| Train defaults, not per-issue ceremony                 | `arbiter.json` gains `ship.train.{maxChain,maxAgeMinutes}` (default 10 / 480) and `ship.review.maxRounds` (default 2), each an integer >= 1. `resolveTrainLimits` merges config over `DEFAULT_TRAIN_LIMITS` per field; `--trainLimits` remains the test seam. `arbiter ship #A #B #C` is sugar for repeated `--chain`.                   |
| Review rounds are capped and delta-scoped              | `ship.review.maxRounds` bounds re-review; each round past the first re-reviews `git diff <base>..HEAD` (delta only) at a sub-HIGH landing threshold. A round past the cap refuses, naming both exits: park findings and land, or `--force-review`.                                                                                       |
| Dispatch sidecar is content-scoped                     | A sidecar entry whose `taskId` names a different task now reads as ABSENT in `check-review-completion`, `check-agent-return --enforce`, and the Stop hook.                                                                                                                                                                               |
| Hooks classify before they block                       | `.claude/agents/agent-write-classes.json` classifies each spawned subagent read-only vs write-intent; a rejected spawn no longer wedges a dispatch slot (the sidecar entry is written only after rejection checks pass).                                                                                                                 |
| stop-dangerous protects evidence from destruction only | The guard strips quoted/heredoc content, splits on `;`/`&&`/`\|`/`\|\|`, and blocks only when a segment's command head (`rm`/`unlink`/`truncate`/`mv`/`cp`/`tee`/`sed -i`) or redirect targets `.arbiter/gate-pass.json`, `.arbiter/status.json`, or `.arbiter/evidence/**`.                                                             |
| `complete` requires MERGED                             | `scripts/pr-merge-watch.mjs` polls until GitHub reports `state === 'MERGED'` with the expected head SHA; a green local gate alone is never sufficient (CLOSER rule 6).                                                                                                                                                                   |

## Consequences

- Evidence-only commits go to zero by construction: an evidence write no longer moves the sha
  it claims to bind to. Baseline: 13.2% of all commits, 8 of 67 on the worst PR.
- Review-loop commits are bounded by `maxRounds` (default 2) and scoped to the round's delta —
  down from an unbounded loop that produced 26 of 67 commits and a 22.7h lead time. Baseline
  aggregate: 29.7% review-loop commits, 1.6h median lead time; the caps target the tail, not
  the median. `hookBlocks` (`pre-spawn-worktree-guard`: 10, `stop-dangerous`: 14) is the
  false-block volume the classification and command-head scoping target.
- `gate-pass.json` stays exact-HEAD, unweakened; the Codex matcher fix is a bugfix, not a
  policy change — it makes the existing hook set actually fire, nothing more.
- A train still carries at most one risk-bearing issue per the sealed-train stop conditions
  (ADR-115); `ship.train` sets the defaults those conditions resolve against, not a replacement.

## Alternatives rejected

- **Keep exact-HEAD binding and suppress the sha-bump commit itself** (amend/squash it away).
  Rejected: hides the symptom without changing why an evidence write invalidates its own
  evidence — the next reviewer hits the same loop.
- **Per-issue ceremony only, batching left to operator discipline.** Rejected: discipline is
  what produced the unbatched 67-commit train; a shipped config default is the only version
  of "batch by default" an unattended run can honor.
- **Accept evidence-refresh commits as the cost of exact-HEAD binding.** Rejected: the cost
  compounds with every review round on a long-lived train, and the baseline already shows 8
  such commits on one PR.
