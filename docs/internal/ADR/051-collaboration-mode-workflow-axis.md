---
title: 'ADR-051: Collaboration-Mode Axis — Branching, CI Shape, and Merge Policy'
doc_version: '1.0.0'
status: active
last_review: '2026-05-28'
owner: ''
canonical_id: '051'
tags: ['audience/dev', 'kind/adr']
related: ['docs/SYSTEM/WORKFLOW-MODEL.md', 'docs/ADR/050-pipeline-complexity-tiers.md']
---

# ADR-051: Collaboration-Mode Axis — Branching, CI Shape, and Merge Policy

**Project:** arbiter
**Date:** 2026-05-28
**Status:** Accepted

## Context

arbiter previously used `soloDevMode: boolean` and the `teamSize` wizard question as
proxies for branching and CI shape. Both are category-error proxies:

- `soloDevMode` is binary and non-extensible. It cannot express the trust/blast-radius
  dimension that actually determines what CI a team needs.
- `teamSize` (small/medium/large) encodes headcount, not deployment frequency or audit
  requirements. A 1-person fintech team has a different risk profile than a 5-person
  internal-tool team with the same headcount.

DORA research (Humble & Farley, _Continuous Delivery_; Forsgren, Humble, Kim,
_Accelerate_) shows that trunk-based development with short-lived feature branches
correlates with elite delivery performance regardless of team size. The
distinguishing axis is **trust + deploy frequency + blast radius**, not headcount.

arbiter's own merge/branching needs surfaced three concrete gaps:

1. `/task` creates branches but does not express whether they land via PR or direct
   fast-forward push.
2. `01-pr-fast.yml` triggered `develop` unconditionally — a phantom branch for all
   non-`github-flow-with-develop` configurations.
3. `soloDevMode=true` still emits PR-shaped workflows, adding unnecessary overhead
   for trunk-direct projects.

## Decision

Introduce `collaborationMode: 'trunk-solo' | 'peer-review' | 'gated-review'` as the
primary branching/CI axis in `arbiter.json`. `soloDevMode` is deprecated and
aliased to `collaborationMode='trunk-solo'` for one minor release.

### Collaboration Mode Definitions

| `collaborationMode` | Trust model                                | Default branching | Default merge            | CI shape                           |
| ------------------- | ------------------------------------------ | ----------------- | ------------------------ | ---------------------------------- |
| `trunk-solo`        | One author; signature = author             | `trunk-direct`    | `direct` (ff-only push)  | T1 (PR-fast) + T4-lite nightly     |
| `peer-review`       | 1+ reviewers, shared trust                 | `github-flow`     | `pr-ff`                  | T1 + T2 (PR-extended) + T4 nightly |
| `gated-review`      | CODEOWNERS, merge queue, attestation chain | `github-flow`     | `pr-ff` + linear history | T1 + T2 + T4 + T5 weekly           |

The wizard still asks team size as a friendly UX prompt and maps answers to
`collaborationMode` defaults. The underlying config stores `collaborationMode` only.

### Governance × Collaboration Coherence Matrix (4×3 = 12 cells)

|                   | trunk-solo                                                                                    | peer-review                                   | gated-review             |
| ----------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------ |
| **L1 lenient**    | OK — ideal for solo OSS                                                                       | OK — ideal for small OSS                      | WARN — uncommon; allowed |
| **L2 standard**   | OK — ideal                                                                                    | OK — ideal                                    | OK — ideal               |
| **L3 strict**     | WARN — no human-approval gate active; solo author approves self                               | OK — ideal                                    | OK — ideal               |
| **L4 compliance** | CRITICAL — rejected (L4 mandates CODEOWNERS + human-approval; incoherent with `direct` merge) | WARN — `pr-ff` mandatory; `direct` overridden | OK — ideal               |

The wizard rejects the `L4 + trunk-solo` cell with a remediation prompt. WARN cells
emit a runtime advisory in `arbiter doctor`.

**Init-time enforcement (#1347).** The CRITICAL cell is also gated at the `arbiter init`
pre-generation step — the same point the L3 maturity gate aborts — so a non-interactive
`init --level L4 --solo` (trunk-solo) is **refused before any files are written**, rather
than scaffolding a full project and only surfacing the incoherence later via `arbiter doctor`.
The gate reuses the same shared checker (`validateCollaborationCoherence`) doctor uses, so the
rule has a single source of truth; init and doctor cannot diverge.

A second, advisory axis, `language × archetype` (`validateLanguageArchetypeCoherence`), is
surfaced at the same init gate (and in `doctor`) for pairs arbiter cannot scaffold (e.g.
`go × frontend-spa`, `python × embedded`). It emits a WARN and **never blocks** generation —
"absurd pairing" is a judgement call with no blocking policy behind it, so a hard abort would
need product sign-off.

### Branching Strategy

`branchingStrategy` is a derived field (not set in wizard; resolved by `resolveBranchingStrategy()`):

| `collaborationMode` | Default `branchingStrategy`                       |
| ------------------- | ------------------------------------------------- |
| `trunk-solo`        | `trunk-direct`                                    |
| `peer-review`       | `github-flow`                                     |
| `gated-review`      | `github-flow` (`github-flow-with-develop` opt-in) |

EJS templates guard `develop`-branch triggers on
`branchingStrategy === 'github-flow-with-develop'`. The phantom `develop` triggers
that existed in arbiter's own workflows are removed by this ADR.

### Pipeline Style Resolution

`pipelineStyle` (the CI complexity selector used by the GitHub generator) is now
resolved from a `(collaborationMode × governanceLevel)` lookup table in
`src/config/collaboration-mode-defaults.ts`. Explicit `pipelineStyle` overrides are
still honoured as an escape hatch.

|        | trunk-solo | peer-review | gated-review |
| ------ | ---------- | ----------- | ------------ |
| **L1** | starter    | starter     | standard     |
| **L2** | starter    | standard    | standard     |
| **L3** | standard   | standard    | industrial   |
| **L4** | standard   | standard    | industrial   |

### Worktree Auto-Mode and Merge Mode

| `collaborationMode` | Default `tasks.worktree` | Default `solo.mergeMode` |
| ------------------- | ------------------------ | ------------------------ |
| `trunk-solo`        | `optional`               | `direct`                 |
| `peer-review`       | `always`                 | `pr-ff`                  |
| `gated-review`      | `always`                 | `pr-ff`                  |

## Migration

`arbiter update` detects `features.soloDevMode: true` and writes
`collaborationMode: 'trunk-solo'` to `arbiter.json` automatically. Projects that
do not run `arbiter update` fall back to the `soloDevMode` alias in
`collaborationModeFromAnswers()`. The `soloDevMode` field will be removed in the
next major release.

INV-100 enforces that every arbiter-scaffolded project declares `collaborationMode`
(scripts/check-collab-mode-wired.mjs, L1 gate).

## Consequences

**Positive:**

- CI and branching scale with trust/blast-radius, not headcount.
- The phantom `develop` branch trigger in PR-fast/PR-extended workflows is eliminated.
- Solo projects no longer receive PR-heavy workflows unless they opt in.
- Migration from `soloDevMode` is automated via `arbiter update`.

**Negative / Trade-offs:**

- Existing `arbiter.json` files without `collaborationMode` will get a warning from
  `arbiter doctor` until `arbiter update` is run.
- The `gated-review + L4` cell is the only cell with full cosign + CODEOWNERS +
  merge-queue CI; reaching it requires explicit opt-in.

## References

- [Trunk-Based Development — Paul Hammant](https://trunkbaseddevelopment.com/)
- [DORA: Trunk-Based Development capability](https://dora.dev/capabilities/trunk-based-development/)
- [Accelerate — Forsgren, Humble, Kim](https://itrevolution.com/product/accelerate/)
- [Kent Beck, "Party of One for Code Review"](https://tidyfirst.substack.com/p/party-of-one-for-code-review)
- Related: ADR-050 (pipeline complexity tiers)
- Related: `docs/SYSTEM/WORKFLOW-MODEL.md` (diagrams + synthesis)
