---
title: 'ADR-050: Pipeline Complexity Tiers — Archetype-Default + Governance Floor'
doc_version: '1.0.0'
status: active
last_review: '2026-05-23'
owner: ''
canonical_id: '050'
tags: ['audience/dev', 'kind/adr']
related: ['docs/internal/SYSTEM/CI-TIER-MODEL.md']
---

# ADR-050: Pipeline Complexity Tiers — Archetype-Default + Governance Floor

**Project:** arbiter
**Date:** 2026-05-23
**Status:** Accepted

## Context

arbiter generates CI/CD pipelines for target projects. The existing model emits one
maximal 10+ workflow system derived from the planning-main reference for all archetypes
and governance levels. Thresholds differ but pipeline shape is constant. A solo
developer with a CLI library should not receive a cosign + Sigstore + k6 load-test
setup. arbiter's mission is "best possible for the team size", which requires that
pipeline complexity scale down as cleanly as it scales up.

Two dimensions already exist in the config model:

- `governanceLevel ∈ {L1, L2, L3, L4}` — compliance strictness
- `archetype ∈ {lib, cli, service, batch, serverless}` — project purpose

The question is which dimension drives pipeline shape.

## Decision

Pipeline shape derives from **project archetype** (primary axis). Governance level
enforces **hard minimums** (floor axis). Neither axis alone is sufficient.

### Archetype → Default Pipeline Shape

| Archetype    | Default workflows emitted                              | Min governance |
| ------------ | ------------------------------------------------------ | -------------- |
| `lib`        | PR gate + publish-only release                         | L1             |
| `cli`        | PR gate + artifact release                             | L1             |
| `service`    | PR fast/extended + deploy-test + deploy-prod + release | L2             |
| `batch`      | PR gate + scheduled + manual trigger                   | L2             |
| `serverless` | PR gate + FaaS deploy (stack-specific) + release       | L2             |

### Governance → Enforcement Floor

Governance injects additional jobs/steps into all archetypes regardless of shape:

| Governance | Injected into ALL archetypes                                                      |
| ---------- | --------------------------------------------------------------------------------- |
| L1         | Nothing extra. Archetype defaults stand.                                          |
| L2         | Required status checks enforced on branch protection.                             |
| L3         | `06-nightly.yml` + `08-heartbeat.yml` added regardless of archetype.              |
| L4         | `03-human-approval.yml` (mandatory) + cosign sign/attest + SBOM + evidence files. |

L4 constraints are invariants, not suggestions. A service at L4 without
`human-approval-required` is a gate failure (INV-74).

### Pipeline Vocabulary (workflow blocks)

| Block name       | Workflows                                | Notes                        |
| ---------------- | ---------------------------------------- | ---------------------------- |
| `gate`           | `01-pr-fast` + `02-pr-extended`          | Always present               |
| `human-approval` | `03-human-approval`                      | L4 mandatory                 |
| `deploy-test`    | `04-deploy-test`                         | service / serverless / batch |
| `release`        | `05-release`                             | All archetypes               |
| `nightly`        | `06-nightly`                             | L3+                          |
| `weekly`         | `07-weekly`                              | L3+                          |
| `heartbeat`      | `08-heartbeat` + `09-heartbeat-external` | L3+                          |
| `deploy-prod`    | `10-deploy-prod`                         | service / serverless         |
| `load-test`      | `11-k6-on-demand`                        | service / serverless, opt-in |
| `slsa`           | cosign + SBOM steps injected             | L4 mandatory, L3 optional    |

### Concrete Examples

**Solo dev, CLI lib, L1:**

```
01-pr-fast.yml
05-release.yml
```

**Small team, service, L2:**

```
01-pr-fast.yml
02-pr-extended.yml
04-deploy-test.yml
05-release.yml
10-deploy-prod.yml
```

**Production service, L3:**

```
01-pr-fast.yml
02-pr-extended.yml
04-deploy-test.yml
05-release.yml
06-nightly.yml
07-weekly.yml
08-heartbeat.yml
10-deploy-prod.yml
```

**Regulated service, L4:**

```
01-pr-fast.yml
02-pr-extended.yml
03-human-approval.yml       ← mandatory (INV-74)
04-deploy-test.yml          ← cosign + SBOM
05-release.yml              ← SLSA L2/L3 + mutation blocking
06-nightly.yml
07-weekly.yml
08-heartbeat.yml
09-heartbeat-external.yml
10-deploy-prod.yml
11-k6-on-demand.yml
```

## Consequences

### Positive

- Pipeline output matches actual project needs — lib projects do not pay for deploy
  infrastructure they cannot use.
- Governance floor remains non-negotiable — L4 invariants cannot be bypassed by
  choosing a lighter archetype.
- Template count stays bounded: 11 workflow files, governance differences expressed as
  EJS guards inside each file (CANON-13), not as separate template files per level.
- Wizard can explain the pipeline shape decision to users ("you chose `service` + L2,
  so you get workflows 01, 02, 04, 05, 10").

### Negative

- Generator must gate on both `archetype` and `governanceLevel` (two-axis selection).
  Existing registry calls need updating when archetype-conditional emission is wired.
- Open question: `deploy-test` environment config source (init-time vs post-init env
  setup) is unresolved — defaulting to placeholder until resolved.
- `serverless` sub-archetype variation (Lambda ≠ Cloud Run ≠ Azure Functions) requires
  a `deployTarget` field (already added in PR #1009) to avoid combinatorial templates.

## Rejected Alternatives

### Option A: Pipeline Profile as independent axis

Two independent dials (`pipelineProfile: minimal|standard|full` × `governanceLevel`)
produce incoherent combinations — `minimal` + `L4` has no defined meaning. The
archetype already encodes the meaningful part of "how much pipeline"; duplication
creates confusion.

### Option B: Governance = Pipeline 1:1

All archetypes at the same governance level get the same pipeline. Blunt. A `lib`
project at L3 governance does not need a docker-push deploy pipeline. Archetype is
real semantic information; ignoring it wastes it.

### Option D: Composable feature flags

Maximum flexibility, zero guidance. arbiter is opinionated by design — expert-only
flag composition is anti-mission. Flags remain available as escape hatches but are not
the primary UX.

## Links

- Spec: `docs/SYSTEM/CI-TIER-MODEL.md`
- Issue: #1004
- Related: ADR-040 (governance tiers), ADR-042 (gate tiers)

## Amendment — Cadence overlay (2026-06, #1502)

The spec referenced above, `docs/SYSTEM/CI-TIER-MODEL.md`, now exists and adds a **cadence
axis** layered on top of the archetype-default + governance-floor model decided here. The
cadence axis classifies every emitted workflow into one of four buckets (ALWAYS / NIGHTLY /
WEEKLY-MONTHLY / PROD) — it decides _when_ a workflow runs, never _which_ governance level
emits it. The emit predicates and the L1-L4 floor in this ADR are unchanged. The cadence
classification is an executable SSOT (`scripts/lib/ci-cadence.mjs`) asserted by
`scripts/check-ci-tiers.mjs`.
