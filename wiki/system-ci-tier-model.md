---
generated: true
source: 'docs/SYSTEM/CI-TIER-MODEL.md'
source_sha: '15eb6254d69c149ebee26df308178239a02c2ed0'
last_updated: '2026-07-03'
---

# CI Tier Model — Cadence × Governance

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/CI-TIER-MODEL.md](../docs/SYSTEM/CI-TIER-MODEL.md)

# CI Tier Model — Cadence × Governance

This is the canonical model for the CI pipeline arbiter generates for a target project.
Two orthogonal axes decide **which** workflows are emitted and **when** they run:

1. **Governance / emit axis** — _which_ workflows a project gets. Driven by the existing
   emit predicates in `src/generators/github.ts`: a pipeline `style`
   (`PIPELINE_STYLE_TABLE[collaborationMode][governanceLevel]`, one of
   `starter | standard | industrial`) plus the `isL2Plus` / `isL3Plus` governance floors.
   This axis is **unchanged** by the cadence model — see [L1-L4 preservation](#l1-l4-preservation-invariant).
2. **Cadence axis** — _when_ an emitted workflow runs. An overlay that classifies every
   workflow into one of four buckets. The cadence buckets do not gate emission; they
   organize the emitted set so fast feedback stays on the PR path and heavy work moves to
   scheduled runs.

The executable SSOT for the cadence axis is `scripts/lib/ci-cadence.mjs`; the emit axis
lives in `src/generators/github.ts` and is enforced by `scripts/check-ci-tiers.mjs`.

## The four cadence buckets

| Bucket             | Triggers                                    | Purpose                                                                 |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| **ALWAYS**         | every `pull_request` / `push` to a branch   | fast feedback — lint, format, typecheck, unit, build, incremental scans |
| **NIGHTLY**        | daily `schedule` (+ `workflow_dispatch`)    | heavy correctness/security sweep + freshness watchdog                   |
| **WEEKLY-MONTHLY** | weekly (Sun/Mon) + monthly `schedule`       | deep audits — mutation, architecture, license, supply-chain posture     |
| **PROD**           | tag push / `release` / deploy push / manual | build → sign → attest → deploy + on-demand load test                    |

### Bucket → workflow assignment

Each workflow belongs to **exactly one** cadence bucket (a strict partition, enforced by
`assertCanonicalPartition` in `scripts/lib/ci-cadence.mjs`).

| Bucket             | Workflows                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALWAYS**         | `01-pr-fast` · `02-pr-extended` · `03-human-approval` · `15-codeql`¹ · `16-frontend-quality` · `18-frontend-lane`                           |
| **NIGHTLY**        | `06-nightly` · `06-nightly-lite` · `09-heartbeat`                                                                                           |
| **WEEKLY-MONTHLY** | `07-weekly` · `07-weekly-lite` · `08-monthly` · `12-mutation-scheduled` · `13-archunit-extended` · `14-license-scan` · `17-ossf-scorecard`¹ |
| **PROD**           | `04-deploy-test` · `05-release` · `10-deploy-prod` · `11-k6-on-demand`                                                                      |

¹ `15-codeql` and `17-ossf-scorecard` also carry a weekly `schedule` backstop, but their
primary trigger is the PR/push gate (CodeQL) and the canonical-branch push (Scorecard), so
they are bucketed by primary purpose. The full template inventory and per-workflow detail
live in [`docs/REFERENCE/ci-tier-workflows.md`](../REFERENCE/ci-tier-workflows.md).

## The emit-predicate contract (governance axis)

A workflow is emitted only when its predicate holds. The cadence overlay never widens or
narrows these predicates — it only labels the result. The predicates (see
`src/generators/github.ts`):

| Workflow(s)                               | Emitted when                                                         |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `01` · `02` · `03`                        | always (every GitHub-enabled project)                                |
| `05-release` (+ `_sigstore-retry-sign`)   | `style !== 'starter'`                                                |
| `06-nightly` · `07-weekly` · `08-monthly` | `style !== 'starter'` **and** `isL3Plus` **and** mode ≠ `trunk-solo` |
| `09-heartbeat`                            | `isL3Plus`                                                           |
| `06-nightly-lite`                         | mode `trunk-solo` **and** `isL2Plus`                                 |
| `07-weekly-lite`                          | mode `trunk-solo` **and** `isL3Plus`                                 |
| `12` · `13` · `14`                        | `style === 'industrial'`                                             |
| `15-codeql`                               | (`peer-review` **and** `isL2Plus`) **or** `gated-review`; not Rust   |
| `16-frontend-quality`                     | review mode **and** `isL2Plus` **and** web archetype                 |
| `17-ossf-scorecard`                       | `gated-review` **and** `isL3Plus`                                    |
| `18-frontend-lane`                        | review mode **and** `isL2Plus` **and** a `frontend/` subtree lane    |
| `04-deploy-test` · `10-deploy-prod`       | `deployTarget !== 'none'`                                            |
| `11-k6-on-demand`                         | perf-k6 generator (service / serverless, opt-in)                     |

`style` is resolved from `collaborationMode × governanceLevel` via
`PIPELINE_STYLE_TABLE` (ADR-051). `isL2Plus = level ∈ {L2,L3,L4}`,
`isL3Plus = level ∈ {L3,L4}`.

## L1-L4 preservation (invariant)

The cadence overlay is **layered on top of** the emit predicates above; it must never
change which governance level emits which workflow. The level-by-level guarantee:

- **L1** — `style` is `starter` (solo) or `standard` (gated). Emits the ALWAYS bucket only
  (`01` · `02` · `03`). No release, no scheduled sweeps.
- **L2** — adds `05-release` for non-`starter` styles; adds `15-codeql` for `peer-review`
  and `gated-review`; adds `06-nightly-lite` for `trunk-solo`.
- **L3** — adds the NIGHTLY/WEEKLY-MONTHLY floor (`06-nightly` · `07-weekly` · `08-monthly`)
  for non-`trunk-solo`, the `07-weekly-lite` deep sweep for `trunk-solo`, plus the
  `09-heartbeat` freshness watchdog. `gated-review` additionally gets `17-ossf-scorecard`.
- **L4** — keeps everything from L3 **and** the regulated PROD guarantees:
  `03-human-approval` is **mandatory** (INV-74), and the release/deploy path keeps
  `cosign` signing + SBOM + attestation + provenance verification — including the SLSA
  L3 hermetic provenance job name and the `Verify container signature (L3 strict)` step
  that L3 carries (not the weaker "L2 signed" label).

This contract is **two-dimensional**: which workflow FILES a level emits (INV-73/INV-72,
below), and how STRICT a given file's CONTENT is once emitted. #1720 found and closed a
gap in the second dimension — `05-release.yml`'s SLSA-provenance strictness, `CODEOWNERS`'
path-owner coverage, `KNOWLEDGE_MAP.md`'s TRACK*ROUTER section, the generated gate's L2+
runtime clamp, and the fail-closed audit's emission — were hand-rolled as literal
`governanceLevel === 'L3'` checks that silently excluded L4, so L4 (the strictest tier)
rendered \_weaker* than L3 in five places while `check-ci-tiers.mjs`'s existence-only check
stayed green. The fix: `levelAtLeast` (`src/config/levels.ts`, #1516) is now injected into
every EJS render as `isL2Plus`/`isL3Plus`/`isL4` (`src/utils/render.ts`), and
`check-ci-tiers.mjs` gained an L3+ CONTENT assertion on `05-release.yml` (INV-72) so a
future regression in this class fails the gate instead of shipping invisible.

This contract is enforced by `scripts/check-ci-tiers.mjs`: the INV-73 canonical-presence
floor, the INV-72 collaboration-mode/level-aware required set (the exact inverse of the
generation predicates) plus i

*[content truncated — see source for full text]*
