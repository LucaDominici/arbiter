# CI Tier Workflows — Reference

arbiter generates a CI tier consisting of up to 8 GitHub Actions workflow files. Each workflow maps to one or more tiers (T0–T6) in the CI model (`docs/SYSTEM/CI-TIER-MODEL.md`).

## Workflow Inventory

| File                    | Tier  | Purpose                                                                      | Mode            |
| ----------------------- | ----- | ---------------------------------------------------------------------------- | --------------- |
| `01-pr-fast.yml`        | T1/T2 | PR gate: lint, format, unit tests, anti-bot approval check                   | baseline + full |
| `02-pr-extended.yml`    | T2b   | Extended gate: integration, contract, behavioral, license tests              | baseline + full |
| `03-human-approval.yml` | T2c   | Bot: applies/revokes `human-approved` label when a non-author human approves | baseline + full |
| `05-release.yml`        | T3    | Release: build, sign, attest, SLSA provenance, publish                       | full only       |
| `06-nightly.yml`        | T4    | Nightly: mutation, full coverage, extended quality checks                    | full only       |
| `07-weekly.yml`         | T5    | Weekly: dep audit, license scan, regression baseline                         | full only       |
| `08-monthly.yml`        | T5b   | Monthly: deep security scan, stale-dep report                                | full only       |
| `09-heartbeat.yml`      | T6    | Heartbeat: watchdog that asserts nightly/weekly/monthly ran on schedule      | baseline + full |
| `_notify.yml`           | —     | Reusable: idempotent GitHub Issue notification (called by other workflows)   | baseline + full |
| `_label-sync.yml`       | —     | Reusable: sync `.github/labels.yml` → repo labels on push to main            | baseline + full |

## Modes

`ciTierMode` in `ProjectConfig` controls which set renders:

- **`baseline`** — emits 01, 02, 03, 09, \_notify, \_label-sync (6 workflow files). Heartbeat runs in warn-only mode (no hard `exit 1` when nightly/weekly/monthly are absent).
- **`full`** (default) — emits all 8 numbered workflows + 2 helpers (10 files). Heartbeat enforces freshness thresholds.

Set in `arbiter.json`:

```json
{ "ciTierMode": "baseline" }
```

## INV-73 Transition Mode

arbiter-self (this repo) operates under `migrationStatus: 'transition'` during W4→W10. The self-gate (`scripts/check-ci-tiers.mjs`) requires 4/8 canonical workflow files. Target projects always require 8/8.

## Supplementary Artifacts

In addition to the workflows, `generateCiTier` emits:

| File                                         | Purpose                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `.github/labels.yml`                         | Canonical label list (size, AI governance, CI tier, lifecycle) |
| `.github/actions/setup-node-pnpm/action.yml` | Composite action for Node + pnpm setup                         |
| `_notify.yml`                                | (also listed above)                                            |
| `_label-sync.yml`                            | (also listed above)                                            |

## Jobs in 01-pr-fast.yml

| Job                       | Depends on                        | Purpose                                                |
| ------------------------- | --------------------------------- | ------------------------------------------------------ |
| `gate`                    | —                                 | Checkout, setup, lint, format check, unit tests, audit |
| `human-approval-required` | —                                 | Verify PR has `human-approved` label (INV-74)          |
| `ci-required`             | `gate`, `human-approval-required` | Status check target for branch protection              |

TypeScript/Java projects add parallel test category jobs (`unit-tests`, `contract-tests`, `integration-tests`, `behavioral-tests`) that fan out from `gate`.

## SHA Pinning (INV-76)

All third-party Actions must be pinned to full 40-char SHAs. The `scripts/check-action-pins.mjs` gate enforces this at L2.

## Permissions (INV-77)

Every generated workflow declares explicit top-level `permissions:` with least-privilege defaults. The `scripts/check-workflow-perms.mjs` gate enforces this at L1.
