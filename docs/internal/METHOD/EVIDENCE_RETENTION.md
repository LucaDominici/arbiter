---
title: 'Evidence Retention Policy — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
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
precedence over `arbiter.json` for testing/CI. Fail-open (inert) when `arbiter.json`
is absent or unreadable — a missing flag never hard-blocks completion claims.

## Scripts

| Script                      | Purpose                                                                                                                 | When to run                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `scripts/done-evidence.mjs` | Run the L4 gate, then capture SHA-256 of load-bearing source files + gate state into `.claude/.last-done-evidence.json` | Before claiming a task done — the `guard-done-evidence` hook reads this file |

## Hook

`guard-done-evidence.mjs` (UserPromptSubmit) activates only when all of:

- `features.evidenceHarness: true` (or `ARBITER_EVIDENCE_HARNESS=1`),
- task phase is `verification`, and
- the prompt contains a completion claim (`task complete`, `pr merged`, …).

It then validates `.claude/.last-done-evidence.json`: `all_green === true`,
`pinned_files` non-empty, and every pinned SHA matches the file on disk. Any drift
since evidence was captured hard-blocks the completion claim (exit 2).

## Location

The evidence snapshot is `.claude/.last-done-evidence.json` (last capture only —
single-file, gitignored). Rotation to a run-history directory is a future
enhancement (templates `evidence-rotate.mjs.ejs` / `evidence-prune.mjs.ejs` exist
for target projects that opt in); arbiter dogfoods the single-snapshot path.

## Governance

The done-evidence harness is the completion backstop paired with
`stop-evidence-guard.mjs` (Stop hook, INV-114). `make evidence` runs the capture
step; `make gate` runs the full gate. The flag flip (not a re-generation) turns
enforcement on.
