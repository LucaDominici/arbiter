---
title: Planning Skeleton Audit
type: audit
status: active
date: 2026-05-19
source_repo: cloud.ms5.planning-main
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/auditor', 'audience/dev', 'kind/audit']
related: []
---

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

| ID       | Path                                           | Stack       | KIT Dims   | Disposition      | Wave   | Purpose                                                                           |
| -------- | ---------------------------------------------- | ----------- | ---------- | ---------------- | ------ | --------------------------------------------------------------------------------- |
| PLAN-031 | `scripts/validate-workflow-sha-pinning.sh`     | agnostic    | 34, 35     | adopt-self       | W6     | Ensures all workflow action refs are SHA-pinned (not @main or @vN). Exits 1 i...  |
| PLAN-032 | `scripts/validate-workflow-runners.sh`         | agnostic    | 34, 35     | adopt-self       | W6     | Verifies runner labels match allowed set. Detects if CI_BUILD_RUNNER_LABEL dr...  |
| PLAN-033 | `scripts/validate-workflow-job-naming.sh`      | agnostic    | 34, 35     | adopt-self       | W6     | Enforces job naming convention (kebab-case, no spaces). Catches drift from do...  |
| PLAN-034 | `scripts/validate-validator-helptext.sh`       | agnostic    | 35         | adopt-self       | W6     | Meta-validator: every validate-\* script must support --help flag. Enforces IN... |
| PLAN-035 | `scripts/validate-suppression-rationale.sh`    | agnostic    | 55, 57     | adopt-self       | W6     | Verifies every suppression entry has a rationale comment. Prevents silent sup...  |
| PLAN-036 | `scripts/validate-trivy-suppression-expiry.sh` | agnostic    | 57         | adopt-self       | W6     | Verifies every Trivy suppression has an expiry date. Detects expired suppress...  |
| PLAN-037 | `scripts/validate-tier-coverage.sh`            | agnostic    | 34, 35, 36 | adopt-self       | W6     | Verifies all required CI tier workflows exist and none are missing. Detects g...  |
| PLAN-038 | `scripts/validate-workflow-docs-sync.sh`       | agnostic    | 34, 76     | adopt-self       | W6     | Verifies workflow file list matches docs/REFERENCE/cicd-developer-reference.m...  |
| PLAN-039 | `scripts/validate-workflow-test-integrity.sh`  | agnostic    | 34, 35     | adopt-self       | W6     | Ensures no test step has continue-on-error: true in workflow files (silent fa...  |
| PLAN-040 | `scripts/validate-pr-size-gate.sh`             | agnostic    | 34, 35     | adopt-self       | W6     | Verifies sensitive-paths.txt patterns are valid globs. PR size gate depends o...  |
| PLAN-041 | `scripts/validate-pitest-override.sh`          | java_spring | 14         | stack-adapter    | F2     | Detects unauthorized PITest threshold overrides in pom.xml. Java-specific.        |
| PLAN-042 | `scripts/validate-required-checks-semantic.sh` | agnostic    | 34, 35     | adopt-self       | W6     | Verifies required status checks in branch protection match documented set.        |
| PLAN-043 | `scripts/validate-crossdb-parity.sh`           | java_spring | 20         | stack-adapter    | F2     | Verifies cross-DB Testcontainers parity between profiles.                         |
| PLAN-044 | `scripts/validate-frontend-template-parity.sh` | java_spring | 5          | stack-adapter    | F2     | Verifies frontend template code patterns match documented conventions.            |
| PLAN-045 | `scripts/validate-k6-scenario-completeness.sh` | template    | 39, 42     | project-template | F6     | Verifies k6 scenario files cover all documented endpoint+scenario combinations.   |
| PLAN-046 | `scripts/validate-arc-readiness.sh`            | java_spring | 34, 35     | reject           | reject | Pre-merge arc migration readiness check. Planning-specific transition artifact.   |
| PLAN-047 | `scripts/validate-nightly-k6.sh`               | template    | 36, 42     | project-template | F6     | Validates that nightly k6 run artifacts exist and are fresh (for heartbeat ve...  |
| PLAN-048 | `scripts/validate-lt6-post.sh`                 | template    | 39, 42     | project-template | F6     | Post-run k6 lt6 scenario validation. Checks report structure.                     |
| PLAN-049 | `scripts/validate-post-run.sh`                 | template    | 39, 42     | project-template | F6     | Generic post-run validation wrapper for k6 scenarios.                             |
| PLAN-055 | `scripts/validate-mybatis-xml-crud.sh`         | java_spring | 45         | stack-adapter    | F2     | Validates MyBatis XML mapper files have CRUD operations aligned with service ...  |
| PLAN-056 | `scripts/validate-schema-isolation.sh`         | java_spring | 46         | stack-adapter    | F2     | Verifies schema isolation between tenants is enforced at DB layer.                |
| PLAN-057 | `scripts/validate-liquibase-naming.sh`         | java_spring | 47         | stack-adapter    | F2     | Validates Liquibase changeset naming conventions (YYYYMMDD-NNN-description).      |
| PLAN-058 | `scripts/validate-liquibase-crossdb.sh`        | java_spring | 47         | stack-adapter    | F2     | Validates Liquibase changesets work across PostgreSQL/MariaDB/MSSQL.              |
| PLAN-059 | `scripts/validate-postman-collection.sh`       | template    | 48         | project-template | F7     | Validates Postman collection structure and environment variable completeness.     |
| PLAN-060 | `scripts/validate-dayofweek-openapi.sh`        | template    | 30         | project-template | F9     | Validates day-of-week OpenAPI constraint annotations are present and correct.     |
| PLAN-068 | `(check-drift.py — inferred from dim 50)`      | agnostic    | 50         | redesign         | W6     | ~400 LOC drift detector: catalog/template/workflow trio consistency. Inferred...  |
| PLAN-164 | `scripts/validate-arc-readiness.sh`            | java_spring | —          | reject           | reject | Arc migration readiness check. Planning-specific tooling.                         |

## Static Analysis (9 items)

| ID       | Path                                                | Stack       | KIT Dims | Disposition   | Wave | Purpose                                                                          |
| -------- | --------------------------------------------------- | ----------- | -------- | ------------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-061 | `scripts/quality-check.sh`                          | agnostic    | 51       | redesign      | DONE | Aggregated quality gate runner: invokes linting, format-check, coverage, arch... |
| PLAN-062 | `scripts/security-scan.sh`                          | agnostic    | 53       | adopt-self    | W6   | Runs Trivy filesystem scan + gitleaks check. Agnostic.                           |
| PLAN-063 | `scripts/security/pii-scan.sh`                      | agnostic    | 54       | adopt-self    | W6   | Whole-repo PII scan using pii-patterns.txt regex corpus. Distinct from per-ed... |
| PLAN-064 | `scripts/security/pii-patterns.txt`                 | agnostic    | 54       | adopt-self    | W6   | PII regex pattern corpus (emails, SSN patterns, IBAN-like, etc.). Used by pii... |
| PLAN-065 | `scripts/jasypt-check.sh`                           | java_spring | 53       | stack-adapter | F2   | Verifies Jasypt-encrypted properties are correctly encrypted (not plaintext a... |
| PLAN-066 | `scripts/verify-spotbugs.sh`                        | java_spring | 11       | stack-adapter | F2   | Runs SpotBugs and checks against baseline.txt + exclude-filter.xml.              |
| PLAN-135 | `config/checkstyle/checkstyle.xml`                  | java_spring | 13       | stack-adapter | F2   | Checkstyle ruleset: CyclomaticComplexity(15), MethodLength(65), etc. 10 KIT-r... |
| PLAN-136 | `config/pmd/ruleset.xml`                            | java_spring | 12       | stack-adapter | F2   | PMD ruleset: cyclomatic(15), TooManyMethods(20), Security ruleset, multithrea... |
| PLAN-137 | `config/spotbugs/baseline.txt + exclude-filter.xml` | java_spring | 11       | stack-adapter | F2   | SpotBugs suppression baseline + exclude filter.                                  |

## Evidence Capture (2 items)

| ID       | Path                                      | Stack    | KIT Dims   | Disposition     | Wave | Purpose                                                                          |
| -------- | ----------------------------------------- | -------- | ---------- | --------------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-067 | `scripts/audit-toolchain.sh`              | agnostic | 51, 52, 53 | adopt-self      | W11  | One-shot toolchain audit: versions, exit codes, durations → dated MD snapshot... |
| PLAN-094 | `docs/ci/validation-evidence-template.md` | agnostic | 51, 52     | adopt-framework | W7   | Template for documenting validation evidence after nightly/weekly runs. Evide... |

## Test Harness (19 items)

| ID       | Path                                                      | Stack       | KIT Dims | Disposition      | Wave   | Purpose                                                                          |
| -------- | --------------------------------------------------------- | ----------- | -------- | ---------------- | ------ | -------------------------------------------------------------------------------- |
| PLAN-070 | `tests/load/assignment.js`                                | template    | 42       | project-template | F6     | k6 assignment-endpoint load scenario.                                            |
| PLAN-071 | `tests/load/availability.js`                              | template    | 42       | project-template | F6     | k6 availability-endpoint load scenario.                                          |
| PLAN-072 | `tests/load/capacity.js`                                  | template    | 42       | project-template | F6     | k6 capacity-endpoint load scenario.                                              |
| PLAN-073 | `tests/load/batch-operations.js`                          | template    | 42       | project-template | F6     | k6 batch-operations scenario.                                                    |
| PLAN-074 | `tests/load/concurrent-booking.js`                        | template    | 42, 43   | project-template | F6     | k6 concurrent-booking scenario. Used for concurrency stress tests.               |
| PLAN-075 | `tests/load/smoke.js`                                     | template    | 42       | project-template | F6     | k6 smoke test (low VU, quick sanity). Critical pattern: every k6 suite needs ... |
| PLAN-076 | `tests/load/stress.js`                                    | template    | 42       | project-template | F6     | k6 stress test (high VU, extended duration).                                     |
| PLAN-077 | `tests/load/lt11-endurance.js`                            | template    | 43       | project-template | F6     | k6 30-min endurance test. KIT dim 43 requires this specific duration.            |
| PLAN-078 | `tests/load/lib/checks.js`                                | template    | 42       | project-template | F6     | Shared k6 check library (status codes, response shape assertions).               |
| PLAN-079 | `tests/load/lib/dataset.js`                               | template    | 42       | project-template | F6     | Shared k6 dataset library (test data fixtures for load scenarios).               |
| PLAN-080 | `tests/load/lib/metrics.js`                               | template    | 42       | project-template | F6     | Shared k6 metrics library (custom counters, thresholds).                         |
| PLAN-081 | `tests/postman/planning-fe-integration.postman_collec...` | template    | 41       | project-template | F7     | Postman collection for frontend integration E2E tests. Newman-runnable.          |
| PLAN-082 | `tests/postman/planning-fe-test5.postman_environment....` | template    | 41       | project-template | F7     | Postman TEST5 environment for Newman runs.                                       |
| PLAN-145 | `scripts/seed-planning-k6.sql`                            | template    | 42       | project-template | F6     | 46KB SQL seed script for k6 load test scenarios. Injects planning entities in... |
| PLAN-146 | `scripts/seed-test-data.sh`                               | template    | 42       | project-template | F6     | Shell wrapper to run seed-planning-k6.sql against test environment.              |
| PLAN-150 | `scripts/test/TestBadChangelog.xml + TestBadPatternsC...` | java_spring | 47, 45   | stack-adapter    | F2     | Bad-input fixture XMLs for Liquibase/MyBatis validators. Test corpus for vali... |
| PLAN-151 | `scripts/test/fixtures/ (4 YAML files)`                   | agnostic    | 39       | adopt-self       | W6     | Workflow fixture files: should-fail/ and should-pass/ test cases for validate... |
| PLAN-152 | `scripts/test/test-validate-workflow-integrity.sh`        | agnostic    | 39       | adopt-self       | W6     | Test runner for validate-workflow-test-integrity validator (uses fixtures PLA... |
| PLAN-165 | `scripts/test/test-preflight-test5.sh`                    | java_spring | —        | reject           | reject | Tests preflight-test5.sh. Planning URL specific.                                 |

## Contract Verification (4 items)

| ID       | Path                                            | Stack    | KIT Dims | Disposition      | Wave | Purpose                                                                        |
| -------- | ----------------------------------------------- | -------- | -------- | ---------------- | ---- | ------------------------------------------------------------------------------ |
| PLAN-085 | `scripts/run-postman-tests.sh`                  | template | 40, 41   | project-template | F7   | 414-LOC Newman runner: collection selection, env injection, report generation. |
| PLAN-086 | `scripts/inject-pact-samples.sh`                | template | 41       | project-template | F7   | Injects Pact sample contracts into test environment before Newman runs.        |
| PLAN-113 | `docs/api/openapi-v1.json`                      | template | 30, 67   | project-template | F9   | OpenAPI 3.x spec for planning API v1. Source of truth for contract tests.      |
| PLAN-114 | `docs/api/planning-api.postman_collection.json` | template | 41, 67   | project-template | F7   | Postman collection linked to OpenAPI spec.                                     |

## Supply Chain Check (3 items)

| ID       | Path                     | Stack       | KIT Dims | Disposition      | Wave | Purpose                                                                          |
| -------- | ------------------------ | ----------- | -------- | ---------------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-090 | `.trivyignore`           | agnostic    | 57       | adopt-self       | W9   | Trivy vulnerability suppression file. Suppressions require rationale + expiry... |
| PLAN-091 | `owasp-suppressions.xml` | java_spring | 15       | stack-adapter    | F2   | OWASP Dependency-Check false-positive suppression file.                          |
| PLAN-092 | `.zap/rules.tsv`         | template    | 44, 57   | project-template | F8   | ZAP DAST scan rules: excluded paths + authentication flow.                       |

## Parity Mechanism (1 items)

| ID       | Path                              | Stack    | KIT Dims | Disposition | Wave | Purpose                                                                          |
| -------- | --------------------------------- | -------- | -------- | ----------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-093 | `scripts/lib/sensitive-paths.txt` | agnostic | 34, 35   | adopt-self  | W6   | Glob patterns of sensitive file paths. Used by validate-pr-size-gate to class... |

## Docs Governance (14 items)

| ID       | Path                                            | Stack       | KIT Dims                       | Disposition      | Wave   | Purpose                                                                          |
| -------- | ----------------------------------------------- | ----------- | ------------------------------ | ---------------- | ------ | -------------------------------------------------------------------------------- |
| PLAN-100 | `docs/ci/README.md`                             | agnostic    | 76                             | adopt-self       | W4     | CI/CD Developer Reference: workflow table, PR lifecycle, run.sh↔CI parity, tr... |
| PLAN-101 | `docs/ci/gate-tier-policy.md`                   | agnostic    | 34, 35                         | adopt-self       | W4     | Documents which tests run in which CI tier. The parity contract in written form. |
| PLAN-102 | `docs/ci/k6-on-demand.md`                       | template    | 39, 42                         | project-template | F6     | k6 on-demand workflow usage guide. Documents VU parameters, pre-flight requir... |
| PLAN-103 | `docs/ci/pr-size-gate.md`                       | agnostic    | 34, 35                         | adopt-self       | W4     | Documents PR size gate: LOC threshold, sensitive-paths logic, how to force ex... |
| PLAN-104 | `docs/ci/runner-strategy.md`                    | agnostic    | 34                             | adopt-self       | W4     | Documents CI runner strategy: mac-self-hosted primary vs ubuntu-latest fallback. |
| PLAN-105 | `docs/testing/TEST_TAXONOMY.md`                 | agnostic    | 25, 27, 28, 29, 30, 31, 32, 33 | adopt-self       | W7     | 25-tag test taxonomy: unit/behavioral/edge-case/contract/concurrent/migration... |
| PLAN-106 | `docs/testing/master-test-plan.md`              | agnostic    | 25                             | project-template | F12    | Master test plan: scope, test types, entry/exit criteria, environments.          |
| PLAN-107 | `docs/coding-standards.md`                      | agnostic    | 63                             | project-template | F12    | Service-specific coding standards: naming, patterns, anti-patterns, code revi... |
| PLAN-108 | `SECURE_CODING_CHECKLIST.md`                    | agnostic    | 66                             | project-template | F12    | Security review checklist: input validation, auth, crypto, secrets, logging, ... |
| PLAN-109 | `docs/adr/ (22 ADRs ADR-011..ADR-032)`          | java_spring | 65                             | docs-only        | DONE   | 22 ADRs for planning domain decisions. Architecture decision record set.         |
| PLAN-110 | `docs/ci/runbooks/nightly-cron-resurrection.md` | agnostic    | 36                             | adopt-self       | W10    | Runbook: how to resurrect a stuck nightly cron job. Mac hibernation + manual ... |
| PLAN-111 | `docs/runbooks/ (4 files)`                      | agnostic    | 68                             | project-template | F12    | Operational runbooks: planning-rollback, troubleshooting, prod-checklist, red... |
| PLAN-112 | `docs/security/risk-assessment-planning.md`     | agnostic    | 66                             | project-template | F12    | STRIDE threat model + risk assessment for planning service.                      |
| PLAN-163 | `docs/ci/MIGRATION.md`                          | java_spring | —                              | reject           | reject | Planning-internal arc migration tracking document.                               |

## Agent Instruction (1 items)

| ID       | Path                   | Stack    | KIT Dims | Disposition | Wave | Purpose                                                                          |
| -------- | ---------------------- | -------- | -------- | ----------- | ---- | -------------------------------------------------------------------------------- |
| PLAN-126 | `CLAUDE.md (planning)` | agnostic | 69       | done        | DONE | AI agent governance contract P1-P28: planning-specific rules, coding patterns... |

## Hook (3 items)

| ID       | Path                   | Stack    | KIT Dims | Disposition | Wave | Purpose                                                                         |
| -------- | ---------------------- | -------- | -------- | ----------- | ---- | ------------------------------------------------------------------------------- |
| PLAN-140 | `.githooks/pre-commit` | agnostic | 55, 59   | done        | DONE | Pre-commit: Spotless format check + gitleaks scan.                              |
| PLAN-141 | `.githooks/pre-push`   | agnostic | 55, 59   | done        | DONE | Pre-push: fast check only (~2 min). CI is authoritative gate (Fowler citation). |
| PLAN-142 | `.githooks/commit-msg` | agnostic | 59       | done        | DONE | Commit message format enforcement (conventional commits).                       |

## Bootstrap (13 items)

| ID       | Path                                                      | Stack       | KIT Dims | Disposition      | Wave   | Purpose                                                                          |
| -------- | --------------------------------------------------------- | ----------- | -------- | ---------------- | ------ | -------------------------------------------------------------------------------- |
| PLAN-120 | `.editorconfig`                                           | agnostic    | 62       | done             | DONE   | Indentation/encoding consistency across editors. 1:1 copy pattern.               |
| PLAN-121 | `.gitleaks.toml`                                          | agnostic    | 55       | done             | DONE   | Gitleaks configuration: rules, allowlist entries with rationale + expiry.        |
| PLAN-122 | `.gitignore`                                              | agnostic    | 62       | adopt-self       | W4     | Repository gitignore. Ensures compose.dev.yaml + .env.local files are never c... |
| PLAN-123 | `.github/dependabot.yml`                                  | agnostic    | 62       | adopt-self       | W4     | Dependabot config: github-actions + maven grouped weekly.                        |
| PLAN-124 | `.github/CODEOWNERS`                                      | agnostic    | 62       | done             | DONE   | CODEOWNERS: maps paths to required reviewers. suppressions files → tech lead ... |
| PLAN-125 | `commitlint.config.js`                                    | agnostic    | 62       | done             | DONE   | Conventional commits enforcement: type/scope/subject rules.                      |
| PLAN-127 | `.github/ISSUE_TEMPLATE/ (4 templates)`                   | agnostic    | 60       | done             | DONE   | Issue templates: bug-report, feature-request, compliance-item, config.yml.       |
| PLAN-128 | `.github/PULL_REQUEST_TEMPLATE.md`                        | agnostic    | 61       | adopt-self       | W8     | PR template: description, test plan, checklist. Includes pipeline artifacts t... |
| PLAN-129 | `Dockerfile`                                              | agnostic    | 37       | project-template | F10    | Multi-stage Docker build: build + runtime stages. COPY --chown, non-root user.   |
| PLAN-130 | `infra/azure/containerapp.tpl.yaml`                       | template    | 37       | project-template | F11    | Azure Container App deployment manifest template.                                |
| PLAN-160 | `scripts/mac-setup/ (3 files)`                            | agnostic    | —        | reject           | reject | macOS launchd plist + runner setup scripts for planning self-hosted CI runner... |
| PLAN-161 | `scripts/preflight-develop.sh + preflight-test5.sh`       | java_spring | —        | reject           | reject | Pre-flight health checks against planning-specific develop/test5 endpoints.      |
| PLAN-162 | `scripts/verify-develop-health.sh + verify-test5-heal...` | java_spring | —        | reject           | reject | Health endpoint verification for planning-specific environments.                 |

---

## Reject Rationale

| ID       | Path                                                        | Reason                                                                 |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| PLAN-046 | `scripts/validate-arc-readiness.sh`                         | Planning-specific arc migration tooling. Not portable.                 |
| PLAN-160 | `scripts/mac-setup/ (3 files)`                              | Planning-specific self-hosted runner management. Not portable. Reject. |
| PLAN-161 | `scripts/preflight-develop.sh + preflight-test5.sh`         | Planning URL + environment specific. Not portable. Reject.             |
| PLAN-162 | `scripts/verify-develop-health.sh + verify-test5-health.sh` | Planning URL + environment specific. Not portable. Reject.             |
| PLAN-163 | `docs/ci/MIGRATION.md`                                      | Planning-specific migration artifact. Not portable.                    |
| PLAN-164 | `scripts/validate-arc-readiness.sh`                         | Planning-specific. Reject.                                             |
| PLAN-165 | `scripts/test/test-preflight-test5.sh`                      | Planning URL specific. Reject.                                         |

---

## Done (Already Present in Arbiter)

| ID       | Path                                    | Notes                                                                                                 |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PLAN-120 | `.editorconfig`                         | Already present in arbiter. No change needed.                                                         |
| PLAN-121 | `.gitleaks.toml`                        | Already present in arbiter. Suppression policy enforcement via PLAN-035.                              |
| PLAN-124 | `.github/CODEOWNERS`                    | Already present in arbiter. Extend with suppression-file CODEOWNER entries in W6.                     |
| PLAN-125 | `commitlint.config.js`                  | Already present in arbiter (commitlint is configured). Pattern is done.                               |
| PLAN-126 | `CLAUDE.md (planning)`                  | Arbiter equivalent is AGENTS.md (more powerful). Planning CLAUDE.md content is not portable verbatim. |
| PLAN-127 | `.github/ISSUE_TEMPLATE/ (4 templates)` | Already present in arbiter. Compliance-item template is pharma-specific (skip for arbiter).           |
| PLAN-140 | `.githooks/pre-commit`                  | Already present in arbiter with gitleaks. Spotless is java-specific; arbiter uses eslint/prettier.    |
| PLAN-141 | `.githooks/pre-push`                    | Already present in arbiter.                                                                           |
| PLAN-142 | `.githooks/commit-msg`                  | Already present in arbiter.                                                                           |

---

## Orphan / Missing / Drift Findings

See `docs/audits/planning-orphan-debt.md` for the full orphan analysis.

Key observations from this inventory:

- **check-drift.py** (PLAN-068): Referenced in KIT dim 50 as planning_source but not found directly in filesystem scan — may be embedded in quality-check.sh or not committed. Redesign as `scripts/check-drift.mjs` in W6 regardless.
- **scripts/test/test-verify-test5-health.sh**: Planning URL-specific test not inventoried — reject.
- **K6 reports (tests/load/reports/)**: 15+ analysis MD files not inventoried — planning run-specific evidence, not templates. Not portable.
- **docs/superpowers/**: AI agent planning docs not inventoried — planning-agent-specific, not portable.
- **planning-specific ADRs (ADR-011..ADR-032)**: Domain-specific decisions inventoried as single PLAN-109 entry (docs-only). Arbiter has its own ADR system.
