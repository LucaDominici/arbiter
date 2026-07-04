---
title: 'ADR-098: Progressive-adoption tiers (bootstrap on-ramp)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-20'
owner: ''
canonical_id: '098'
tags: ['audience/dev', 'kind/adr']
related: ['008-governance-levels', '028-level-upgrade-grace-and-contract-type']
---

# ADR-098: Progressive-adoption tiers (bootstrap on-ramp)

**Project:** arbiter
**Date:** 2026-06-20
**Status:** Accepted
**Epic:** #1438 (child #1447)

## Context

`arbiter init` was effectively all-or-nothing: a project picked a governance level
(`L1`–`L4`) and immediately adopted the full feature set for it. For a greenfield repo
that is fine, but for a brownfield or early-startup team it is a real adoption barrier —
their existing code cannot pass a cold L1 gate on day one, so they bounce off entirely.

The pieces of an on-ramp already existed but were unconnected:

- **L1** is already the minimal runnable gate (format + lint + unit; debt gates,
  security scanning, mutation, and the evidence harness are all off below their level —
  see ADR-008).
- **brownfield baseline lock-in** (`--brownfield`, `maybeCaptureBaseline`) captures
  pre-existing debt as a baseline so it annotates rather than blocks.
- **grace period** (ADR-028) softens the L1→L2 cliff to a 30-day WARN window, started by
  `arbiter upgrade-level --target L2`.
- **`arbiter configure --set governanceLevel=…`** promotes a project post-init.

What was missing was (a) a single entry point that composes the gentlest possible Day-1
start, and (b) a **documented ladder** telling a team what to be green for before
graduating. There was no tier _below_ L1 and no written entry/exit criteria.

## Decision

Introduce a progressive-adoption **tier** axis exposed through `arbiter init --tier
<bootstrap|L1|L2|L3|L4>`. The tier **desugars into existing, type-safe settings** — it
adds no new persisted config field and no parallel level concept:

- `--tier bootstrap` → governance **L1** (the minimal runnable gate) **+ brownfield
  baseline lock-in**. This is the gentlest Day-1 entry: a messy repo gets a gate that
  runs and passes because its pre-existing debt is captured as a baseline, not thrown as
  day-1 red.
- `--tier L1|L2|L3|L4` → a governance-level alias (no forced brownfield).
- `--tier` takes precedence over `--level`.

The transition mechanism is **the machinery that already exists** — `arbiter
upgrade-level` (grace-softened level bumps) and `arbiter configure` (level promotion) —
not a new state machine.

### The adoption ladder (entry / exit criteria)

| Tier          | Gate                                                     | Entry criteria (be green here to enter)                            | Exit criteria (graduate when)                                             |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **bootstrap** | L1 + brownfield baseline                                 | `arbiter init --tier bootstrap` runs clean                         | format + lint + unit are green with **no** baseline reliance for new code |
| **L1**        | format + lint + unit                                     | bootstrap exit met                                                 | line coverage meets the L2 threshold; no debt-ratchet regressions         |
| **L2**        | + coverage + audit + debt ratchet + contract/integration | L1 exit met (use `upgrade-level --target L2` for the 30-day grace) | mutation score meets the L3 bar; E2E suite green                          |
| **L3**        | + mutation + E2E + evidence artifacts                    | L2 exit met                                                        | compliance controls in place                                              |
| **L4**        | + compliance                                             | L3 exit met                                                        | —                                                                         |

Criteria are **advisory defaults** (a starting contract, not hard gates) — a team tunes
the thresholds for its context. The ladder is enforced softly: graduation is a human
decision executed through `upgrade-level`/`configure`, and the grace period (ADR-028)
prevents a graduation from being a cliff.

## Consequences

- **Positive:** brownfield/startup teams have a real on-ramp — one command for the
  gentlest start, a written ladder for what to fix before each step, and grace-softened
  graduation. Built entirely from existing parts, so there is no new persisted state, no
  schema change, and no second concept competing with `governanceLevel`.
- **Negative / trade-off:** `bootstrap` is not a governance level _below_ L1 — it is "L1
  with the existing brownfield lock-in." A future iteration could add a sub-L1 gate
  profile (format-only) if even L1 proves too strict for some adopters; this ADR keeps
  the surface minimal until that need is demonstrated.
- The tier is a **view over `(governanceLevel, brownfield, grace)`**, not a stored
  field; tooling and docs read it from those, keeping a single source of truth.

## Alternatives considered

- **A new `governanceLevel` value (`L0`/`bootstrap`)** — rejected: it ripples through
  `thresholds-by-level`, the config schema enum, every bake snapshot, and dozens of
  level-count tests, to express something the existing L1 + brownfield already covers.
- **A persisted `adoptionTier` field** — rejected for now: it duplicates information
  derivable from `(governanceLevel, brownfield, grace)` and adds schema/dogfood ripple
  for no behavioural gain. Revisit if a stored ladder position becomes load-bearing.
