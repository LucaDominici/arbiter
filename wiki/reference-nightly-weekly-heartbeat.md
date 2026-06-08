---
generated: true
source: 'docs/REFERENCE/nightly-weekly-heartbeat.md'
source_sha: '62ab5683cf392b3d5bf0a8f3a69b26e1751da104'
last_updated: '2026-06-08'
---

# Nightly / Weekly / Heartbeat — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/nightly-weekly-heartbeat.md](../docs/REFERENCE/nightly-weekly-heartbeat.md)

# Nightly / Weekly / Heartbeat — Reference

## Overview

arbiter ships three scheduled CI tier workflows for deep quality checks and watchdog monitoring:

| Workflow           | Tier | Schedule         | Purpose                                           |
| ------------------ | ---- | ---------------- | ------------------------------------------------- |
| `06-nightly.yml`   | T4   | Daily 02:00 UTC  | Mutation testing, CVE refresh, fuzz, secret scan  |
| `07-weekly.yml`    | T5   | Sunday 04:00 UTC | Dep freshness, action-pin audit, cross-OS matrix  |
| `08-monthly.yml`   | T5b  | 04:00 UTC day 1  | Dep age audit, action major-bump scan, SBOM check |
| `09-heartbeat.yml` | T6   | Daily 06:00 UTC  | Watchdog — asserts nightly/weekly/monthly ran     |

## Invariants

- **INV-73:** CI tier presence — 6/8 canonical workflow files must exist (transition mode; target: 8/8)
- **INV-75:** Heartbeat watchdog — T4 nightly ≤26 h, T5 weekly ≤8 d, T5b monthly ≤35 d
- **INV-82:** Monthly (T5b) workflow present + heartbeat asserts ≤32 d freshness
- **INV-93:** Nightly freshness gate — `.arbiter/nightly/last-run.json` must not be older than 26 hours when present

## Operational notes

### Regenerating workflow files from templates

The committed `.github/workflows/*.yml` files are emitted from EJS templates in
`src/templates/github/workflows/`. The parity test
`__tests__/parity/ci-tier-render-parity.test.ts` enforces byte-equality on every
PR. Use `scripts/render-tier-template.mjs` to regenerate a single workflow:

```sh
node scripts/render-tier-template.mjs \
    --template github/workflows/08-monthly.yml.ejs \
    --out .github/workflows/08-monthly.yml
```

Default fixture: `__tests__/fixtures/ci-tier-render-context.json`.

### Shell-safety guards on `gh run list`

Heartbeat freshness assertions invoke `gh run list --workflow=<file>`. When a
referenced workflow file doesn't exist yet, `gh` exits non-zero and trips
`set -e`. Every such call must end with `2>/dev/null || echo '[]'` so the
downstream `jq` parse receives a valid empty JSON array. The test
`__tests__/templates/heartbeat-shell-safety.test.ts` enforces this pattern on
the rendered heartbeat output.

### Label parity

Workflows that file regression issues use `--label nightly-regression`,
`--label weekly-regression`, `--label monthly-regression`. Every label
referenced anywhere in `.github/workflows/*.yml` must have a matching entry in
`.github/labels.yml`. The test
`__tests__/parity/ci-tier-render-parity.test.ts` enforces this (hard) and warns
on orphan labels (soft).

## Nightly (T4) — `06-nightly.yml`

Runs at 02:00 UTC daily and on `workflow_dispatch`.

### Jobs

| Job                | Informational           | Hard fail                     |
| ------------------ | ----------------------- | ----------------------------- |
| `mutation-deep`    | Yes (continue-on-error) | No                            |
| `dep-cve-refresh`  | No                      | Yes                           |
| `fuzz`             | Yes                     | No                            |
| `gitleaks-history` | Yes                     | No                            |
| `evidence-collect` | Yes                     | No                            |
| `nightly-required` | —                       | Yes (dep-cve-refresh failure) |

A nightly regression creates a GitHub issue labelled `nightly-regression` (idempotent: one open issue at a time).

## Weekly (T5) — `07-weekly.yml`

Runs at 04:00 UTC every Sunday and on `workflow_dispatch`.

### Jobs

| Job                    | Informational | Hard fail              |
| ---------------------- | ------------- | ---------------------- |
| `dep-freshness`        | Yes           | No                     |
| `action-version-audit` | Yes           | No                     |
| `cross-os-matrix`      | Yes           | No                     |
| `weekly-required`      | —             | No (all informational) |

A weekly regression creates a GitHub issue labelled `weekly-regression` (idempotent).

## Heartbeat (T6) — `09-heartbeat.yml`

Runs at 06:00 UTC daily (after nightly completes). Calls the GitHub API to check when nightly/weekly/monthly last ran. In baseline mode (when workflow is not yet present), it exits 0 vacuously.

## INV-93 Freshness Gate

`scripts/check-nightly-freshness.mjs` is a local gate (L1) that reads `.arbiter/nightly/last-run.json`:

```json
{ "timestamp": "2026-05-20T02:15:00.000Z" }
```

The stamp file is written by the `evidence-collect` job in `06-nightly.yml`. When no stamp file exists, the gate exits 0 (vacuous pass — nightly not yet configured). When the stamp is older than 26 hours, the gate exits 1.

```bash
# Manual check
node scripts/check-nightly-freshness.mjs

# Override defaults
node scripts/check-nightly-freshness.mjs --artifact=.arbiter/nightly/last-run.json --max-age-hours=26
```

## EJS Templates

Generated projects receive nightly/weekly/heartbeat via:

- `src/templates/github/workflows/06-nightly.yml.ejs`
- `src/templates/github/workflows/07-weekly.yml.ejs`
- `src/templates/github/workflows/09-heartbeat.yml.ejs`

Templates are gated by `ciTierMode: 'full'` in `ProjectConfig`. In `baseline` mode, only 01/02/03/09 are emitted.
