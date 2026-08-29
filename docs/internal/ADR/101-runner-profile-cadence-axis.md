---
title: 'ADR-101: runnerProfile cadence axis (solo/fleet)'
doc_version: '1.0.0'
status: active
last_review: '2026-07-01'
owner: ''
canonical_id: '101'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/SYSTEM/CI-TIER-MODEL.md',
    'docs/internal/ADR/050-pipeline-complexity-tiers.md',
    'docs/internal/ADR/051-collaboration-mode-workflow-axis.md',
  ]
---

# ADR-101: runnerProfile cadence axis (solo/fleet)

**Project:** arbiter
**Date:** 2026-07-01
**Status:** Accepted

## Context

The nightly reusable workflow (`_nightly.yml`) runs two heavy scheduled jobs —
`fuzz` (property-based fuzzing) and `soak-e2e` (full soak / E2E suite) — every
night, hard-gated by `nightly-required` (a failing job exits 1 and files a
`nightly-regression` issue). This is the right cadence for a project with a CI
fleet of runners, where a nightly heavy sweep is cheap relative to available
capacity.

A project running on a single self-hosted runner (a genuinely solo setup, not
merely `collaborationMode: 'trunk-solo'` — that axis governs branching/merge
ceremony, not runner capacity) cannot always absorb a nightly heavy sweep
(fuzz can run 30 min, soak-e2e up to 60 min) without starving the fast
PR-path feedback loop that shares the same runner. There was no way to move
just these two jobs to a less frequent cadence without hand-editing the
generated workflow (which `arbiter update` would then clobber).

This ties into the already-approved [CI Tier Model](../SYSTEM/CI-TIER-MODEL.md)
(6-tier T0..T6, cadence × governance). The cadence model already has a WEEKLY
bucket; this ADR does not add a new bucket — it adds a config-driven
sub-overlay that reassigns two specific jobs between the existing NIGHTLY and
WEEKLY-MONTHLY buckets.

## Decision

Add an orthogonal `runnerProfile: 'solo' | 'fleet'` axis to `ProjectConfig` /
`ArbiterConfigV2`, threaded through the same round-trip machinery as
`deployTarget` / `strictnessTier` / `industryOverlay` (wizard prompt → config →
persisted `arbiter.json` → re-read on `update`/`diff` → EJS render context).

- **`fleet` (default)** — current behavior, byte-behavior-identical: `fuzz` +
  `soak-e2e` run at nightly cadence, hard-gated by `nightly-required`. The
  default collapses to absence in persisted `arbiter.json` (mirrors
  `deployTarget: 'none'` / `industryOverlay: 'none'`), so a clean fleet
  round-trip never mentions the axis.
- **`solo`** — `fuzz` + `soak-e2e` move to the weekly reusable workflow
  (`_weekly.yml`) instead. Critically, moving cadence does **not** relax
  enforcement: `weekly-required` gains the same hard-fail-and-file-issue
  semantics nightly-required has today for these two jobs — a failing
  fuzz/soak-e2e on `solo` still exits 1 and files a `weekly-regression` issue.
  This is a cadence-only trade, never an enforcement-only one.

The two job bodies (which are identical regardless of which parent workflow
includes them — they only reference bare `language`/`buildTool`, inherited via
EJS include scope) are extracted into a shared partial,
`src/templates/github/workflows/_partials/scheduled-heavy-jobs.ejs`, included
by `_nightly.yml.ejs` under `<% if (locals.runnerProfile !== 'solo') %>` and by
`_weekly.yml.ejs` under `<% if (locals.runnerProfile === 'solo') %>`. This
guarantees the two profiles cannot drift — there is exactly one copy of each
job body.

The wizard's `runnerProfile` prompt is universal (asked for every project, not
gated on archetype/collaborationMode), defaulting to `fleet`. For the
`trunk-solo` collaboration mode at L1/L2 (which emits the `-lite` nightly/weekly
variants that never define fuzz/soak at all — see [CI Tier
Model](../SYSTEM/CI-TIER-MODEL.md#l1-l4-preservation-invariant)), the axis is an
inert no-op: there is nothing to move. This is intentional — `runnerProfile`
governs runner _capacity_, not branching ceremony, and the two concerns are
orthogonal (a solo dev on a beefy CI fleet is `trunk-solo` × `fleet`; a small
team sharing one self-hosted runner is `peer-review` × `solo`).

## Consequences

### Positive

- A project on a single self-hosted runner can opt out of nightly heavy
  sweeps without losing the hard-gate/issue-filing safety net — it just moves
  to a weekly cadence.
- `fleet` (the default) is byte-behavior-identical to pre-ADR-101 output — no
  existing generated project's CI changes unless it explicitly opts into
  `solo`.
- The cadence overlay stays layered correctly on top of the CI Tier Model: the
  workflow-file → bucket partition (`06-nightly.yml` / `07-weekly.yml` stay in
  their `CADENCE_BUCKETS`) is unchanged — only _jobs within_ those files move,
  so INV-73 (both the required-set and the canonical-presence floor) is untouched.
- The `scheduled-heavy-jobs.ejs` partial removes a duplication risk: without
  it, `solo` support would require hand-duplicating two multi-stack job
  bodies into `_weekly.yml`, which would drift from `_nightly.yml` on the next
  edit to either.

### Negative

- One more axis in the wizard flow (18 questions now instead of 17) and one
  more cell in the `ProjectConfig`/`ArbiterConfigV2` surface to reason about,
  though it follows the existing scalar-optional-enum pattern exactly
  (`validateOptionalEnums`, `PATH_TO_KEYS['runnerProfile'] = ['github']`), so
  the marginal maintenance cost is small.
- `solo` still runs the same total fuzz/soak-e2e minutes per week as `fleet`
  (7 nightly runs vs 1 weekly run is not free — the weekly run does not scale
  down scope). A future refinement could scale `solo`'s soak-e2e budget, but
  that is out of scope here; this ADR only moves cadence.

## Links

- Related ADRs: ADR-050 (pipeline complexity tiers), ADR-051 (collaboration
  mode axis)
- Spec: `docs/SYSTEM/CI-TIER-MODEL.md` — "Runner-profile sub-overlay" section
- Issues: #1693
