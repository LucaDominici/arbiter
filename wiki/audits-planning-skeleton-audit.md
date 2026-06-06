---
generated: true
source: 'docs/audits/planning-skeleton-audit.md'
source_sha: '9e71e56fdf097f02a2af53cc492ddca808952218'
last_updated: '2026-06-06'
---

# Planning Skeleton Audit

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/audits/planning-skeleton-audit.md](../docs/audits/planning-skeleton-audit.md)

# Planning Skeleton Audit — Full Classified Inventory

> Machine-readable source: `docs/audits/planning-skeleton-inventory.json` (123 items)
> Each item: path · category · stack · KIT dims · disposition · arbiter target · wave

---

## Summary

| Metric                    | Count |
| ------------------------- | ----- |
| Total items inventoried   | 123   |
| adopt-self                | 40    |
| adopt-framework           | 6     |
| redesign                  | 7     |
| stack-adapter (F2/F5)     | 14    |
| project-template          | 39    |
| docs-only                 | 1     |
| done (already in arbiter) | 9     |
| reject                    | 7     |

---

## Local Command Harness (8 items)

| ID       | Path                         | Stack    | KIT Dims                                   | Disposition     | Wave | Purpose                                                                          |
| -------- | ---------------------------- | -------- | ------------------------------------------ | --------------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-001 | `run.sh`                     | agnostic | 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36 | redesign        | W3   | Single-entrypoint 1640-LOC 26-subcommand orchestrator. Tier-parity contract: ... |
| PLAN-002 | `setup-repo.sh`              | agnostic | 59, 62                                     | adopt-self      | W3   | Git hooks path enforcement + Node/JDK version verification. Idempotent.          |
| PLAN-003 | `scripts/setup-dev.sh`       | agnostic | 59, 70                                     | adopt-framework | W3   | Local dev environment bootstrap: compose.dev.yaml, .env.develop, Docker healt... |
| PLAN-004 | `scripts/setup-hooks.sh`     | agnostic | 59                                         | redesign        | W3   | Install git hooks. Delegates to setup-repo.sh in modern form.                    |
| PLAN-005 | `scripts/start-dev.sh`       | agnostic | 70                                         | adopt-framework | W3   | Start local dev environment: Docker Compose + health wait.                       |
| PLAN-006 | `compose.dev.yaml.example`   | agnostic | 70                                         | adopt-framework | W3   | Dev Compose example committed; real compose.dev.yaml gitignored. Container co... |
| PLAN-007 | `.env.develop.local.example` | agnostic | 70                                         | adopt-framework | W3   | Dev env var contract: all keys present, values safe for commit.                  |
| PLAN-008 | `.env.test5.local.example`   | agnostic | 70                                         | adopt-framework | W3   | TEST env var contract (second profile). Same pattern as .env.develop.            |

## Ci Workflow (19 items)

| ID       | Path                                          | Stack       | KIT Dims   | Disposition      | Wave | Purpose                                                                          |
| -------- | --------------------------------------------- | ----------- | ---------- | ---------------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-011 | `.github/workflows/01-pr-fast.yml`            | agnostic    | 34, 35     | adopt-self       | W4   | T2 PR gate: lint + build + fast tests + arch checks + human-approval-required... |
| PLAN-012 | `.github/workflows/02-pr-extended.yml`        | agnostic    | 34, 35     | adopt-self       | W4   | Dynamic PR gate: slow tests + Trivy + k6 smoke. Fires if >=100 LOC prod OR se... |
| PLAN-013 | `.github/workflows/03-deploy-test.yml`        | agnostic    | 37         | project-template | F10  | Build + Cosign sign + push ACR + deploy TEST env + smoke. Fires after merge t... |
| PLAN-014 | `.github/workflows/04-deploy-prod.yml`        | agnostic    | 37         | project-template | F10  | Deploy PROD with human-approval Environment gate. Fires on release.              |
| PLAN-015 | `.github/workflows/05-release.yml`            | agnostic    | 16, 37     | adopt-self       | W9   | Full superset: PITest + Trivy strict + Cosign keyless sign + SBOM attestation... |
| PLAN-016 | `.github/workflows/06-nightly.yml`            | agnostic    | 36         | redesign         | W10  | Nightly: OWASP + ZAP DAST + PITest + gitleaks history + Newman E2E + Toxiprox... |
| PLAN-017 | `.github/workflows/07-weekly.yml`             | agnostic    | 36         | redesign         | W10  | Weekly: cross-DB tests (PostgreSQL→MSSQL→MariaDB) via Testcontainers. Cron Su... |
| PLAN-018 | `.github/workflows/08-heartbeat.yml`          | agnostic    | 36         | adopt-self       | W10  | Cron 18:00 UTC on mac-runner. Verifies nightly ran within 26h. Opens nightly-... |
| PLAN-019 | `.github/workflows/09-heartbeat-external.yml` | agnostic    | 36         | adopt-self       | W4   | Backup heartbeat on ubuntu-latest. Detects mac runner offline. Fully automatic.  |
| PLAN-020 | `.github/workflows/10-k6-on-demand.yml`       | template    | 39         | project-template | F6   | Manual-only k6 workflow. VU-configurable. Pre-flight gate if vus>10.             |
| PLAN-021 | `.github/workflows/_cleanup-weekly.yml`       | agnostic    | 36         | adopt-self       | W10  | Reusable (workflow_call): ACR tag retention + stale PROD run cleanup. Called ... |
| PLAN-022 | `.github/workflows/_k6-runner.yml`            | template    | 39, 42, 43 | project-template | F6   | Reusable k6 runner library. Port isolation + trap cleanup. Called from 06-nig... |
| PLAN-023 | `.github/workflows/_label-on-approve.yml`     | agnostic    | 38         | adopt-self       | W8   | Applies approved-by-human label. Triple-check: actor≠author + actor.type≠Bot ... |
| PLAN-024 | `.github/workflows/_notify.yml`               | agnostic    | 36         | adopt-self       | W4   | Reusable idempotent GH-Issue notification: same title = append comment, not n... |
| PLAN-025 | `.github/workflows/_pr-staleness.yml`         | agnostic    | 38         | adopt-self       | W8   | Cron daily: draft PR >30d → warn. Draft PR >60d → close automatically.           |
| PLAN-026 | `.github/workflows/_sigstore-retry-sign.yml`  | agnostic    | 16, 37     | adopt-self       | W9   | Manual-only retroactive Sigstore re-sign. Used when 05-release fails on sign-... |
| PLAN-027 | `.github/workflows/zz-issue-state.yml`        | agnostic    | 38         | adopt-self       | W8   | PR open/close/merge → update label + state of linked issues. Governance autom... |
| PLAN-028 | `.github/workflows/zz-release-openapi.yml`    | agnostic    | 37         | project-template | F9   | Publishes OpenAPI spec as release asset when release is published.               |
| PLAN-029 | `.github/actions/setup-java-maven/action.yml` | java_spring | 34, 35     | redesign         | W4   | Composite action: Java 21 + Maven cache + settings.xml wiring. Called by all ... |

## Anti Drift Validator (27 items)

| ID       | Path                                       | Stack    | KIT Dims | Disposition | Wave | Purpose                                                                          |
| -------- | ------------------------------------------ | -------- | -------- | ----------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-031 | `scripts/validate-workflow-sha-pinning.sh` | agnostic | 34, 35   | adopt-self  | W6   | Ensures all workflow action refs are SHA-pinned (not @main or @vN). Exits 1 i... |
| PLAN-032 | `scripts/validate-workflow-runners.sh`     | agnostic | 34, 35   | adopt-self  | W6   | Verifies runner labels match allowed set. Detects if CI_BUILD_RUNNER_LABEL dr... |
| PLAN-033 | `scripts/validate-workflow-job-naming.sh`  | agnostic | 34, 35   | adopt-self  | W6   | Enforces job naming convention (kebab-case, no spaces). Catches drift from do... |

| PLAN-0

_[content truncated — see source for full text]_
