---
generated: true
source: 'docs/REFERENCE/ci-tier-workflows.md'
source_sha: 'dbb0685a26448df98452a0edd6d8f0c1a9ab893c'
last_updated: '2026-07-03'
---

# CI Tier Workflows — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/ci-tier-workflows.md](../docs/REFERENCE/ci-tier-workflows.md)

# CI Tier Workflows — Reference

arbiter generates a CI tier of up to **18 numbered workflow files** (`01`–`18`, plus the
`06-nightly-lite` / `07-weekly-lite` variants), a set of reusable helper workflows, and three
**reusable schedule partials** (`_nightly.yml`, `_weekly.yml`, `_monthly.yml`). Every
numbered workflow is classified into one of four **cadence buckets** (ALWAYS / NIGHTLY /
WEEKLY-MONTHLY / PROD) and is emitted only when its governance/emit predicate holds. The
model — cadence axis × governance axis — is specified in
[`docs/SYSTEM/CI-TIER-MODEL.md`](../SYSTEM/CI-TIER-MODEL.md); this page is the per-workflow
inventory.

### Thin-caller / reusable-partial pattern (#1691)

`06-nightly.yml`, `07-weekly.yml`, and `08-monthly.yml` are **thin callers**: they carry only
the schedule trigger, `workflow_dispatch:`, and the top-level `concurrency:` group. All job
definitions live in the corresponding `_nightly.yml` / `_weekly.yml` / `_monthly.yml`
reusable partials (invoked via `uses: ./.github/workflows/_*.yml`). This keeps the job
definitions testable in isolation and prevents schedule/concurrency settings from leaking into
the `workflow_call:` context (GitHub does not propagate `concurrency:` from a caller into a
called workflow).
Each reusable partial also declares an explicit top-level `name:` so GitHub Actions displays a
readable workflow label instead of the raw `.github/workflows/_*.yml` path.

> Which workflows a given project receives depends on its `collaborationMode`,
> `governanceLevel`, `archetype`, and `deployTarget`. The "Emitted when" column is the exact
> predicate from `src/generators/github.ts` (and `perf-k6.ts` / `ci-tier.ts`). The cadence
> overlay never changes those predicates — see CI-TIER-MODEL.md §L1-L4 preservation.

## Workflow inventory (by cadence bucket)

### ALWAYS — every PR / push (fast feedback)

| File                      | Emitted when                                     | Purpose                                                            |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `01-pr-fast.yml`          | always                                           | PR gate: lint, format, typecheck, unit tests, build, audit         |
| `02-pr-extended.yml`      | always                                           | Extended gate: integration, contract, behavioral, license (scoped) |
| `03-human-approval.yml`   | always (mandatory at L4, INV-74)                 | Applies/asserts the human-approved label (non-author human review) |
| `15-codeql.yml`           | `peer-review` + L2+, or `gated-review`; not Rust | CodeQL SAST on PR/push (+ weekly cron backstop)                    |
| `16-frontend-quality.yml` | review mode + L2+ + web archetype                | Lighthouse / axe / bundle checks on frontend PRs                   |
| `18-frontend-lane.yml`    | review mode + L2+ + a `frontend/` subtree lane   | Path-scoped frontend gate for a `frontend/` lane                   |

### NIGHTLY — daily schedule (heavy sweep + watchdog)

| File                  | Emitted when                                      | Purpose                                                               |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `06-nightly.yml`      | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Thin caller → `_nightly.yml` (schedule 02:00 UTC + concurrency group) |
| `06-nightly-lite.yml` | `trunk-solo` + L2+                                | Lite nightly: integration + CVE refresh (no mutation/SLSA/SBOM)       |
| `09-heartbeat.yml`    | L3+                                               | Daily watchdog: asserts nightly/weekly/monthly ran on schedule        |

### WEEKLY-MONTHLY — weekly (Sun/Mon) + monthly schedule (deep audits)

| File                        | Emitted when                                      | Purpose                                                                                |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `07-weekly.yml`             | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Thin caller → `_weekly.yml` (schedule Sun 03:00 UTC + concurrency group)               |
| `07-weekly-lite.yml`        | `trunk-solo` + L3+                                | Lite weekly deep sweep: dep freshness, action-pin audit, Semgrep SAST + secret history |
| `08-monthly.yml`            | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Thin caller → `_monthly.yml` (schedule 1st of month 04:00 UTC + concurrency group)     |
| `12-mutation-scheduled.yml` | `style === 'industrial'`                          | Scheduled mutation testing (Mon)                                                       |
| `13-archunit-extended.yml`  | `style === 'industrial'`                          | Scheduled architecture-rule enforcement (Mon)                                          |
| `14-license-scan.yml`       | `style === 'industrial'`                          | Scheduled license / SBOM scan (Mon)                                                    |
| `17-ossf-scorecard.yml`     | `gated-review` + L3+                              | OSSF Scorecard supply-chain posture (Mon + push to main)                               |

### PROD — build / sign / attest / deploy (release path)

| File                  | Emitted when                                   | Purpose                                                           |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `04-deploy-test.yml`  | `deployTarget !== 'none'`                      | Deploy to ephemeral/test env on push to main; cosign + SBOM at L4 |
| `05-release.yml`      | `style !== 'starter'`                          | Tag-triggered: build, sign, attest, SLSA provenance, publish      |
| `10-deploy-prod.yml`  | `deployTarget !== 'none'`                      | Deploy on `release: published`; provenance verification           |
| `11-k6-on-demand.yml` | perf-k6 generator (service/serverless, opt-in) | Manual (`workflow_dispatch`) k6 load test                         |

## Reusable & utility workflows (no cadence bucket)

| File                       | Emitted when                               | Purpose                                                                    |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `_nightly.yml`             | same as `06-nightly.yml`                   | Reusable partial: all nightly job definitions (called by `06-nightly.yml`) |
| `_weekly.yml`              | same as `07-weekly.yml`                    | Reusable partial: all weekly job definitions (called by `07-weekly.yml`)   |
| `_monthly.yml`             | same as `08-monthly.yml`                   | Reusable partial: all monthly job definitions (called by `08-monthly.yml`) |
| `_notify.yml`              | GitHub enabled                             | Reusable: idempotent GitHub Issue notification                             |
| `_label-sync.yml`          | GitHub enabled                             | Reusable: sync `.github/labels.yml` → repo labels on push to main          |
| `_label-on-approve.yml`    | GitHub enabled                             | Bot: label management on PR review approval                                |
| `_ai-draft-check.yml`      | GitHub enabled                             | Bot: AI-draft PR detection / labelling                                     |
| `_pr-staleness.yml`        | GitHub enabled                             | Bot: stale-PR sweep                                                      

*[content truncated — see source for full text]*

## See Also

- [[system-ci-tier-model]] — related
