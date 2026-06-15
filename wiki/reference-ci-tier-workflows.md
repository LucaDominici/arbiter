---
generated: true
source: 'docs/REFERENCE/ci-tier-workflows.md'
source_sha: '9dcc4aa3d5e7dc0ef8f35d86edceac6407be4c6c'
last_updated: '2026-06-15'
---

# CI Tier Workflows — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/ci-tier-workflows.md](../docs/REFERENCE/ci-tier-workflows.md)

# CI Tier Workflows — Reference

arbiter generates a CI tier consisting of up to 8 GitHub Actions workflow files. Each workflow maps to one or more tiers (T0–T6) in the CI model (`docs/SYSTEM/CI-TIER-MODEL.md`).

## Workflow Inventory

| File                     | Tier  | Purpose                                                                      | Mode            |
| ------------------------ | ----- | ---------------------------------------------------------------------------- | --------------- |
| `01-pr-fast.yml`         | T1/T2 | PR gate: lint, format, unit tests, anti-bot approval check                   | baseline + full |
| `02-pr-extended.yml`     | T2b   | Extended gate: integration, contract, behavioral, license tests              | baseline + full |
| `03-human-approval.yml`  | T2c   | Bot: applies/revokes `human-approved` label when a non-author human approves | baseline + full |
| `05-release.yml`         | T3    | Release: build, sign, attest, SLSA provenance, publish                       | full only       |
| `06-nightly.yml`         | T4    | Nightly: mutation, full coverage, extended quality checks                    | full only       |
| `07-weekly.yml`          | T5    | Weekly: dep audit, license scan, regression baseline                         | full only       |
| `08-monthly.yml`         | T5b   | Monthly: deep security scan, stale-dep report                                | full only       |
| `09-heartbeat.yml`       | T6    | Heartbeat: watchdog that asserts nightly/weekly/monthly ran on schedule      | baseline + full |
| `_notify.yml`            | —     | Reusable: idempotent GitHub Issue notification (called by other workflows)   | baseline + full |
| `_label-sync.yml`        | —     | Reusable: sync `.github/labels.yml` → repo labels on push to main            | baseline + full |
| `_post-merge-notify.yml` | —     | Optional: email CODEOWNERS after each merged PR (#943, opt-in, L2+ only)     | opt-in (L2+)    |

## Modes

`ciTierMode` in `ProjectConfig` controls which set renders:

- **`baseline`** — emits 01, 02, 03, 09, \_notify, \_label-sync (6 workflow files). Heartbeat runs in warn-only mode (no hard `exit 1` when nightly/weekly/monthly are absent).
- **`full`** (default) — emits all 8 numbered workflows + 2 helpers (10 files). Heartbeat enforces freshness thresholds.

Set in `arbiter.json`:

```json
{ "ciTierMode": "baseline" }
```

## INV-73 Transition Mode

arbiter-self (this repo) operates under `migrationStatus: 'transition'` during W4→W10. The self-gate (`scripts/check-ci-tiers.mjs`) requires 6/8 canonical workflow files (01+02+03+06+07+09 present; 05-release and 08-monthly pending). Target projects always require 8/8.

## Supplementary Artifacts

In addition to the workflows, `generateCiTier` emits:

| File                                          | Purpose                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/labels.yml`                          | Canonical label list (size, AI governance, CI tier, lifecycle)                           |
| `.github/actions/setup-node-pnpm/action.yml`  | Composite action for Node + pnpm setup                                                   |
| `.github/actions/setup-java-maven/action.yml` | Composite action for Java + Maven setup with reactor restore (Java projects only, #1226) |
| `_notify.yml`                                 | (also listed above)                                                                      |
| `_label-sync.yml`                             | (also listed above)                                                                      |

## Jobs in 01-pr-fast.yml

| Job                       | Depends on                                                 | Purpose                                                              |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `build-reactor`           | —                                                          | Maven only: pre-fetch deps, tar `$HOME/.m2`, upload artifact (#1226) |
| `gate`                    | `build-reactor` (maven), or — (others)                     | Checkout, setup, lint, format check, unit tests, audit               |
| `human-approval-required` | —                                                          | Verify PR has `human-approved` label (INV-74)                        |
| `ci-required`             | `gate`, `human-approval-required`, `build-reactor` (maven) | Status check target for branch protection                            |

TypeScript/Java projects add parallel test category jobs (`unit-tests`, `contract-tests`, `integration-tests`, `behavioral-tests`) that fan out from `gate`. Java/Maven jobs download the reactor artifact and restore `$HOME/.m2/repository` via the `setup-java-maven` composite action.

## SHA Pinning (INV-76)

All third-party Actions must be pinned to full 40-char SHAs. The `scripts/check-action-pins.mjs` gate enforces this at L2.

## Permissions (INV-77)

Every generated workflow declares explicit top-level `permissions:` with least-privilege defaults. The `scripts/check-workflow-perms.mjs` gate enforces this at L1.

## Post-merge CODEOWNERS notification (#943, opt-in)

Set `enableCodeownersNotify: true` in `arbiter.json` to emit `_post-merge-notify.yml`. Available at L2+ only.

**What it does:** Sends a plain-text email to each CODEOWNERS-listed address after every merged PR. Body includes PR URL, author, coverage %, and changed file list (capped at 100 entries).

**Required secrets** (repository or organization):

- `MAIL_SERVER` — SMTP host (e.g. `smtp.gmail.com`)
- `MAIL_PORT` — `465` (SSL) or `587` (STARTTLS); defaults to `587` if absent
- `MAIL_USERNAME` — SMTP auth user; also used as `From:`/`To:` header
- `MAIL_PASSWORD` — SMTP auth password / app token

**Required variable** (not secret):

- `MAIL_DOMAIN_ALLOWLIST` — comma-separated allowed email domains (e.g. `acme.com,partner.io`), or `*` to allow all. **Required**: feature is disabled when unset to prevent CODEOWNERS-injection exfiltration. Set to `*` only after weighing the persistent-exfiltration risk.

**CODEOWNERS lookup priority:** `.github/CODEOWNERS` → `CODEOWNERS` (root) → `docs/CODEOWNERS` — first match wins (GitHub spec). The matcher supports `*`, `*.ext`, `path/`, and `/anchored` patterns; `**` is **not** supported (uses `fnmatch`, not gitignore engine).

**Security hardening:**

- All PR context (`title`, `author`, etc.) passed via `env:` block + `os.environ` to prevent script injection
- `EmailMessage` API auto-rejects CRLF in headers
- BCC delivery (recipients hidden from each other)
- Recipient cap of 10 per send; STARTTLS + cert validation; SMTP exceptions logged as redacted
- `github.run_attempt == 1` guard prevents resend on workflow re-run
