---
title: 'CI Tier Workflows — Reference'
doc_version: '2.0.0'
status: active
last_review: '2026-06-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['docs/SYSTEM/CI-TIER-MODEL.md']
---

# CI Tier Workflows — Reference

arbiter generates a CI tier of up to **18 numbered workflow files** (`01`–`18`, plus the
`06-nightly-lite` / `07-weekly-lite` variants) and a set of reusable helper workflows. Every
workflow is classified into one of four **cadence buckets** (ALWAYS / NIGHTLY /
WEEKLY-MONTHLY / PROD) and is emitted only when its governance/emit predicate holds. The
model — cadence axis × governance axis — is specified in
[`docs/SYSTEM/CI-TIER-MODEL.md`](../SYSTEM/CI-TIER-MODEL.md); this page is the per-workflow
inventory.

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

| File                  | Emitted when                                      | Purpose                                                         |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `06-nightly.yml`      | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Full nightly: mutation, full coverage, DAST, dep-CVE            |
| `06-nightly-lite.yml` | `trunk-solo` + L2+                                | Lite nightly: integration + CVE refresh (no mutation/SLSA/SBOM) |
| `09-heartbeat.yml`    | L3+                                               | Daily watchdog: asserts nightly/weekly/monthly ran on schedule  |

### WEEKLY-MONTHLY — weekly (Sun/Mon) + monthly schedule (deep audits)

| File                        | Emitted when                                      | Purpose                                                                                |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `07-weekly.yml`             | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Weekly: dep audit, license scan, regression baseline                                   |
| `07-weekly-lite.yml`        | `trunk-solo` + L3+                                | Lite weekly deep sweep: dep freshness, action-pin audit, Semgrep SAST + secret history |
| `08-monthly.yml`            | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Monthly: deep security scan, stale-dep report                                          |
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

| File                       | Emitted when                               | Purpose                                                           |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `_notify.yml`              | GitHub enabled                             | Reusable: idempotent GitHub Issue notification                    |
| `_label-sync.yml`          | GitHub enabled                             | Reusable: sync `.github/labels.yml` → repo labels on push to main |
| `_label-on-approve.yml`    | GitHub enabled                             | Bot: label management on PR review approval                       |
| `_ai-draft-check.yml`      | GitHub enabled                             | Bot: AI-draft PR detection / labelling                            |
| `_pr-staleness.yml`        | GitHub enabled                             | Bot: stale-PR sweep                                               |
| `_sigstore-retry-sign.yml` | with `05-release` (`style !== 'starter'`)  | Reusable: cosign signing with retry/backoff                       |
| `_post-merge-notify.yml`   | L2+ **and** `enableCodeownersNotify: true` | Optional: email CODEOWNERS after each merged PR (#943, opt-in)    |
| `issue-state.yml`          | GitHub enabled                             | Issue lifecycle state automation                                  |
| `drift-shadow.yml`         | `enableSoloDevMode` (trunk-solo)           | Shadow drift-detection for solo/trunk repos                       |

`_contract-postman.yml`, `_k6-runner.yml`, and the `_cosign-copy` / `_deploy` / `_partials`
directories are sub-workflow partials included by the workflows above (contract testing, k6
runner, signing/deploy reuse); they are not independently scheduled.

## INV-73 canonical presence floor

`scripts/check-ci-tiers.mjs` enforces presence of the canonical numbered set
(`01`, `02`, `03`, `05`, `06`, `07`, `08`, `09`) via the INV-73 `minPresent` floor (read
from `src/invariants/catalog.ts`; arbiter-self runs at `minPresent: 6` during the
`migrationStatus: 'transition'` window, target projects require the full set). On top of the
floor, the gate verifies:

- **INV-72 collaboration-mode/level-aware required set** — the exact inverse of the
  generation predicates (e.g. `trunk-solo` + L3+ requires the nightly slot
  `06-nightly-lite | 06-nightly`, the weekly slot `07-weekly-lite | 07-weekly`, and
  `09-heartbeat`).
- **Cadence partition (PORT D1, #1502)** — every canonical workflow must be classified into
  exactly one cadence bucket in `scripts/lib/ci-cadence.mjs`; a canonical workflow added
  without a cadence classification fails the gate. This keeps the docs, the generator, and
  the gate in lockstep.

## Supplementary artifacts

In addition to the workflows, `generateCiTier` / `generateGithub` emit:

| File                                          | Purpose                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/labels.yml`                          | Canonical label list (size, AI governance, CI tier, lifecycle)                           |
| `.github/extended-ci-paths.txt`               | Version-controlled SSOT of sensitive paths the `02-pr-extended` check-trigger gate reads |
| `.github/dependabot.yml`                      | Dependency update config                                                                 |
| `.github/actions/setup-node-pnpm/action.yml`  | Composite action for Node + pnpm setup                                                   |
| `.github/actions/setup-java-maven/action.yml` | Composite action for Java + Maven setup with reactor restore (Java projects only, #1226) |
| `.github/actions/build-cache/action.yml`      | Composite build-cache action (node-workspace / wheel restore) (#1497)                    |
| `.github/actions/sign-and-attest/action.yml`  | Composite cosign sign + attest action (release/deploy path)                              |

## Jobs in 01-pr-fast.yml

| Job                       | Depends on                                                 | Purpose                                                              |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `build-reactor`           | —                                                          | Maven only: pre-fetch deps, tar `$HOME/.m2`, upload artifact (#1226) |
| `gate`                    | `build-reactor` (maven), or — (others)                     | Checkout, setup, lint, format check, unit tests, audit               |
| `human-approval-required` | —                                                          | Verify PR has `human-approved` label (INV-74)                        |
| `ci-required`             | `gate`, `human-approval-required`, `build-reactor` (maven) | Status check target for branch protection                            |

TypeScript/Java projects add parallel test category jobs (`unit-tests`, `contract-tests`,
`integration-tests`, `behavioral-tests`) that fan out from `gate`. Java/Maven jobs download
the reactor artifact and restore `$HOME/.m2/repository` via the `setup-java-maven` composite
action.

## SHA pinning (INV-76)

All third-party Actions must be pinned to full 40-char SHAs (with a `# vX` version comment).
The `scripts/check-action-pins.mjs` gate enforces this at L2.

## Permissions (INV-77)

Every generated workflow declares explicit top-level `permissions:` with least-privilege
defaults. The `scripts/check-workflow-perms.mjs` gate enforces this at L1.

## Post-merge CODEOWNERS notification (#943, opt-in)

Set `enableCodeownersNotify: true` in `arbiter.json` to emit `_post-merge-notify.yml`.
Available at L2+ only.

**What it does:** Sends a plain-text email to each CODEOWNERS-listed address after every
merged PR. Body includes PR URL, author, coverage %, and changed file list (capped at 100
entries).

**Required secrets** (repository or organization):

- `MAIL_SERVER` — SMTP host (e.g. `smtp.gmail.com`)
- `MAIL_PORT` — `465` (SSL) or `587` (STARTTLS); defaults to `587` if absent
- `MAIL_USERNAME` — SMTP auth user; also used as `From:`/`To:` header
- `MAIL_PASSWORD` — SMTP auth password / app token

**Required variable** (not secret):

- `MAIL_DOMAIN_ALLOWLIST` — comma-separated allowed email domains (e.g. `acme.com,partner.io`),
  or `*` to allow all. **Required**: feature is disabled when unset to prevent
  CODEOWNERS-injection exfiltration. Set to `*` only after weighing the persistent-exfiltration
  risk.

**CODEOWNERS lookup priority:** `.github/CODEOWNERS` → `CODEOWNERS` (root) → `docs/CODEOWNERS`
— first match wins (GitHub spec). The matcher supports `*`, `*.ext`, `path/`, and `/anchored`
patterns; `**` is **not** supported (uses `fnmatch`, not gitignore engine).

**Security hardening:**

- All PR context (`title`, `author`, etc.) passed via `env:` block + `os.environ` to prevent
  script injection
- `EmailMessage` API auto-rejects CRLF in headers
- BCC delivery (recipients hidden from each other)
- Recipient cap of 10 per send; STARTTLS + cert validation; SMTP exceptions logged as redacted
- `github.run_attempt == 1` guard prevents resend on workflow re-run
