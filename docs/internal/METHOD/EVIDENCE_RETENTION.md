---
title: 'Evidence Retention Policy — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-09-09'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: ['METHOD/PROCESS.md', 'METHOD/TESTING.md', 'SYSTEM/CANON.md']
---

# Evidence Retention Policy — arbiter

This document defines how task-completion evidence is captured and validated for
arbiter's own dogfood (issue #1872). The harness ships to target projects via the
`guard-done-evidence.mjs.ejs` / `done-evidence.mjs.ejs` templates; this page
documents the arbiter-internal materialization.

## Activation flag

The harness is **flag-gated** and ships inert. The `guard-done-evidence` hook no-ops
(exit 0) until `features.evidenceHarness: true` is set in `arbiter.json`. This makes
the flag flip the single owner-flippable activation switch — the artifacts (hook,
script, wiring) travel with it, so flipping the flag alone turns enforcement on.

Env override `ARBITER_EVIDENCE_HARNESS` (`1`/`true` on, `0`/`false` off) takes
precedence over `arbiter.json` for testing/CI. An absent `arbiter.json` leaves the optional harness inert. Malformed or unreadable configuration blocks completion; it cannot disable enforcement.

## Scripts

| Script                      | Purpose                                                                                                                    | When to run                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `scripts/done-evidence.mjs` | Reuse a valid current L3 marker or run one L3, then capture a v2 receipt in `.arbiter/evidence/done/<sanitized-task>.json` | Before claiming a task done — the `guard-done-evidence` hook reads this file |

## Hook

`guard-done-evidence.mjs` (UserPromptSubmit) activates only when all of:

- `features.evidenceHarness: true` (or `ARBITER_EVIDENCE_HARNESS=1`),
- task phase is `verification`, and
- the prompt contains a completion claim (`task complete`, `pr merged`, …).

The prompt and Stop guards validate the same receipt contract as the independent
engine used by `arbiter task advance --to complete`: current task, passed state,
exact marker digest, candidate identity, readable matching pinned files and
required runtime proof. Backend live API and frontend render/visual requirements
cannot be disabled with `required:false`. Missing, corrupt, pending, failed or
stale evidence blocks completion.

## Location and capture order

The current receipt is `.arbiter/evidence/done/<sanitized-task>.json`. Sanitization
uses the native task-id whitelist and length limit; the original task id must also
match. Capture atomically writes `pending` before configuration or gates, records
`failed` on an unsuccessful attempt, and publishes `passed` only after verification.

The exact legacy `.claude/.last-done-evidence.json` is moved into retained history
under `.arbiter/evidence/done/legacy/` before qualification and never accepted as a
fallback. Receipt writes stay outside source identity; other `.claude` content
remains part of the qualified tree.

Run capture on the final committed candidate before push. A valid L3 marker also
satisfies the native L2 push boundary. After landing, verify receipt and exact PR
head/merge refs plus concluded CI without repeating unchanged suites.

## Governance

The done-evidence harness is the completion backstop paired with
`stop-evidence-guard.mjs` (Stop hook, INV-114). `make evidence` runs the capture
step; `make gate` runs the full gate. The flag flip (not a re-generation) turns
enforcement on.
