---
title: 'CI Tier Workflows — Reference'
doc_version: '2.0.0'
status: active
last_review: '2026-06-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['docs/internal/SYSTEM/CI-TIER-MODEL.md']
---

# CI Tier Workflows — Reference

arbiter generates a CI tier of up to **18 numbered workflow files** (`01`–`18`, plus the
`06-nightly-lite` / `07-weekly-lite` variants), a set of reusable helper workflows, and three
**reusable schedule partials** (`_nightly.yml`, `_weekly.yml`, `_monthly.yml`). Every
numbered workflow is classified into one of four **cadence buckets** (ALWAYS / NIGHTLY /
WEEKLY-MONTHLY / PROD) and is emitted only when its governance/emit predicate holds. The
model — cadence axis × governance axis — is specified in
[`docs/internal/SYSTEM/CI-TIER-MODEL.md`](../internal/SYSTEM/CI-TIER-MODEL.md); this page is the per-workflow
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

| File                  | Emitted when                                      | Purpose                                                                                                     |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `06-nightly.yml`      | `style !== 'starter'` + L3+ + mode ≠ `trunk-solo` | Thin caller → `_nightly.yml` (schedule 02:00 UTC + concurrency group)                                       |
| `06-nightly-lite.yml` | `trunk-solo` + L2+                                | Lite nightly: integration + CVE refresh (no mutation/SLSA/SBOM)                                             |
| `09-heartbeat.yml`    | L3+                                               | Daily watchdog: asserts nightly/weekly/monthly ran on schedule (needs `actions: read` to query run history) |

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
| `_ai-draft-check.yml`      | GitHub enabled                             | Bot: AI-draft PR detection / labelling (INV-91; `dependabot[bot]` exempt)  |
| `_pr-staleness.yml`        | GitHub enabled                             | Bot: stale-PR sweep                                                        |
| `_sigstore-retry-sign.yml` | with `05-release` (`style !== 'starter'`)  | Reusable: cosign signing with retry/backoff                                |
| `_post-merge-notify.yml`   | L2+ **and** `enableCodeownersNotify: true` | Optional: email CODEOWNERS after each merged PR (#943, opt-in)             |
| `issue-state.yml`          | GitHub enabled                             | Issue lifecycle state automation                                           |
| `drift-shadow.yml`         | `enableSoloDevMode` (trunk-solo)           | Shadow drift-detection for solo/trunk repos                                |

`_contract-postman.yml`, `_k6-runner.yml`, and the `_cosign-copy` / `_deploy` / `_partials`
directories are sub-workflow partials included by the workflows above (contract testing, k6
runner, signing/deploy reuse); they are not independently scheduled.

## INV-73 canonical presence floor

`scripts/check-ci-tiers.mjs` enforces presence of the canonical numbered set
(`01`, `02`, `03`, `05`, `06`, `07`, `08`, `09`) via the INV-73 `minPresent` floor (read
from `src/invariants/catalog.ts`; arbiter-self runs at `minPresent: 6` during the
`migrationStatus: 'transition'` window, target projects require the full set). On top of the
floor, the gate verifies:

- **INV-73 collaboration-mode/level-aware required set** — the exact inverse of the
  generation predicates (e.g. `trunk-solo` + L3+ requires the nightly slot
  `06-nightly-lite | 06-nightly`, the weekly slot `07-weekly-lite | 07-weekly`, and
  `09-heartbeat`).
- **Cadence partition (PORT D1, #1502)** — every canonical workflow must be classified into
  exactly one cadence bucket in `scripts/lib/ci-cadence.mjs`; a canonical workflow added
  without a cadence classification fails the gate. This keeps the docs, the generator, and
  the gate in lockstep.

## Supplementary artifacts

In addition to the workflows, `generateCiTier` / `generateGithub` emit:

| File                                          | Purpose                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/labels.yml`                          | Canonical label list (size, AI governance, CI tier, lifecycle)                                                                                                                                                                                                 |
| `.github/extended-ci-paths.txt`               | Version-controlled SSOT of sensitive paths the `02-pr-extended` check-trigger gate reads                                                                                                                                                                       |
| `.github/dependabot.yml`                      | Dependency update config                                                                                                                                                                                                                                       |
| `.github/actions/setup-node-pnpm/action.yml`  | Composite action for Node + pnpm setup                                                                                                                                                                                                                         |
| `.github/actions/setup-java-maven/action.yml` | Composite action for Java + Maven setup with reactor restore (Java projects only, #1226)                                                                                                                                                                       |
| `.github/actions/build-cache/action.yml`      | Composite build-cache action (node-workspace / wheel restore) (#1497). Uses `actions/cache/save`+`restore`, not `upload/download-artifact` (#2058) — cross-job scratch data belongs in Cache's auto-evicting quota, not the manually-retained Artifacts store. |
| `scripts/gh-cleanup-expired-artifacts.mjs`    | Nightly safety net: deletes Actions artifacts GitHub already marked expired but hasn't physically purged (#2058)                                                                                                                                               |
| `.github/actions/sign-and-attest/action.yml`  | Composite cosign sign + attest action (release/deploy path)                                                                                                                                                                                                    |
| `sonar-project.properties`                    | SonarQube project config; JaCoCo XML path set per build tool (`maven` → `target/coverage/jacoco.xml`, `gradle` → `build/coverage/coverage.xml`)                                                                                                                |

## Jobs in 01-pr-fast.yml

| Job                       | Depends on                                                 | Purpose                                                              |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `build-reactor`           | —                                                          | Maven only: pre-fetch deps, tar `$HOME/.m2`, upload artifact (#1226) |
| `gate`                    | `build-reactor` (maven), or — (others)                     | Checkout, setup, lint, format check, unit tests, audit               |
| `human-approval-required` | —                                                          | Verify PR has `human-approved` label (INV-74)                        |
| `ci-required`             | `gate`, `human-approval-required`, `build-reactor` (maven) | Status check target for branch protection                            |

> **Gitleaks scan scope (#1908):** `security-early-fail`'s `gitleaks detect` call (and the
> matching L2 check in `scripts/check-all.mjs`) passes `--log-opts="HEAD"`. Without it, gitleaks
> defaults to scanning **all refs** reachable in the checkout's object DB — since the checkout
> step above uses `fetch-depth: 0` (every remote branch, not just this one) — so an unrelated,
> never-merged branch's commit can fail the Security gate for every other open PR. `--log-opts`
> still walks the full history of the ref actually being tested; it just stops other branches
> from leaking in. The nightly `gitleaks-history` job intentionally keeps `--all --full-history`
> as the deep, cross-branch safety net — that tradeoff (fast/narrow per-PR vs. slow/broad nightly)
> is deliberate, not a gap.

TypeScript/Java projects add a `unit-tests` job that fans out from `gate`. Java/Maven jobs
download the reactor artifact and restore `$HOME/.m2/repository` via the `setup-java-maven`
composite action.

> **Tier-assignment fix (#1875):** `contract-tests`/`integration-tests`/`behavioral-tests` used
> to run unconditionally here even though the "Extended gate" row above already documented them
> as the **scoped** T2 suite. On arbiter's own dogfooded CI this measured ~12min for
> `contract-tests` alone, blowing the ≤15min T1 budget (ADR-090). #1839 (F3 friction cut)
> root-caused this and confirmed a self-repo-only fix was not viable — `.github/workflows/01-pr-fast.yml`
> / `02-pr-extended.yml` must render byte-identical to this template
> (`__tests__/parity/ci-tier-render-parity.test.ts`), so the template and arbiter's own
> materialized workflows had to move together. #1875 moved all three jobs to
> `02-pr-extended.yml.ejs` (fanning out from `check-trigger`, conditionally
> triggered), added the previously-missing `contract-tests` job to that T2 lane
> (it used to be T1-only, asymmetric with integration/behavioral), and added
> realistic `stepEstimates` for `test:contract`/`test:integration`/`test:behavioral`
> to `__tests__/fixtures/workflow-perf-budgets.json` (they previously fell through
> to the 1-minute `_default`, which is why the static critical-path gate never
> caught the regression).

## SHA pinning (INV-76)

All third-party Actions must be pinned to full 40-char SHAs (with a `# vX` version comment).
The `scripts/check-action-pins.mjs` gate enforces this at L2.

## Permissions (INV-77)

Every generated workflow declares explicit top-level `permissions:` with least-privilege
defaults. The `scripts/check-workflow-perms.mjs` gate enforces this at L1.

**Reusable-workflow propagation (#2049):** a job in a `workflow_call`-triggered file (e.g.
`_nightly.yml`) can only be granted a permission scope the _caller_ also grants — GitHub
validates the union at dispatch time and rejects the whole run (`startup_failure`, 0 jobs
created) if a job requests a scope the caller never passed down. The `cleanup-expired-artifacts`
job (`scripts/gh-cleanup-expired-artifacts.mjs`, above) needs `actions: write`; that scope is
granted in all three places the chain requires it: `06-nightly.yml`'s top-level `permissions:`,
its `nightly:` job's `permissions:`, and `_nightly.yml`'s top-level (`workflow_call`)
`permissions:`. When adding a job that needs a new permission scope, grant it in all three
layers, not just the job itself.

## Alternative shape: collapsed 5-lane CI doctrine (#1825, opt-in)

`enableFiveLaneCi: true` replaces the entire numbered-workflow inventory above with the
collapsed 5-lane shape: **pre-commit** (local, via `.githooks` — no workflow file) plus
exactly **4 workflow files** — `ci.yml` (PR-blocking), `nightly.yml`, `weekly.yml`, and
`release.yml` (release-seal on tag push) — each carrying its tier + time budget in a header
comment. It is **mutually exclusive** with the standard `github`/`ci-tier` generators
(`src/generators/registry.ts`), so a project never receives the union of both shapes.

**Activation (#1835 Task B):**

- **Wizard**: an opt-in confirm prompt (step 14.5, default No) shown only when the
  decomposition backend is GitHub.
- **Recipe**: `"enableFiveLaneCi": true` in a `--recipe` JSON file — the non-interactive
  path.
- **Persistence**: stored as `features.fiveLaneCi` in `arbiter.json`, read back on every
  `arbiter update` / `arbiter diff`, so the opt-in survives regeneration.

## Worktree pre-commit skip (#1695)

`.githooks/pre-commit` detects when it is running inside a git worktree (`[ -f ".git" ]` —
worktrees have a `.git` file, not a directory) and exits early after running gitleaks but
before the full L1 gate. This avoids the `node_modules` symlink issue that causes
`gen-third-party-licenses` to report 0 production deps in worktrees (root cause tracked in
#1695). CI enforces the full gate on the integration branch, so no governance gap exists.

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
