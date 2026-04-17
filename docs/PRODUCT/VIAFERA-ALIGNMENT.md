# Arbiter — Viafera Alignment Analysis

**Status:** Active
**Last updated:** 2026-04-09
**Purpose:** Exhaustive gap analysis between arbiter (framework) and viafera (reference implementation). This document persists the analysis so future sessions don't restart from scratch.

---

## Context

Viafera is a production-grade Java 21/Spring Boot 3 + Vue 3/TypeScript project that implements industrial governance. It demonstrates what a mature project looks like after months of manual governance setup. Arbiter should be able to generate equivalent governance for any new project.

Viafera implements **31 enforcement mechanisms** across 8 layers. Almost all are **fail-closed** (hard gate — build fails, CI blocks, merge rejected).

---

## Layer 1: Architecture Verification

### 1.1 Hexagonal Boundaries (INV-01, INV-02, INV-03)

**Viafera:** ArchUnit with 9 active rules in `HexagonalArchitectureTest.java`:

- `DomainPurityTests` (2 rules) — blocks Spring/JPA/Envers/JSR-305 annotations in `domain/**`
- `DependencyFlowTests` (4 rules) — blocks domain→adapter, domain→application, application→infrastructure, cross-module outbound
- `PortsIndependenceTests` (4 rules) — blocks inbound/outbound ports from depending on adapters
- `CrossModulePortDisciplineTests` (2 rules) — blocks PipelineStep/Analytics from direct domain imports

**Gate:** HARD (build fails). No `allowEmptyShould()`.

**Arbiter today:** Generates 1 ArchUnit test (`NoMockMvcTest.java`).

**Gap:** CRITICAL — 1 test vs 9+. Missing domain purity, dependency flow, ports independence, cross-module discipline.

### 1.2 RestAssured Enforcement (INV-32, ADR-093)

**Viafera:** ArchUnit `RestAssuredArchTest.java`:

- Every `*ControllerIT` must extend `RestAssuredBaseIT`
- Legacy exemption list (13 controllers) with documented wave migration
- Full HTTP stack exercised: JwtDecoder, Spring Security, content negotiation, serialization

**Gate:** HARD (build fails).

**Arbiter today:** Generates `NoMockMvcTest.java` (checks for MockMvc imports) but NOT:

- `RestAssuredBaseIT.java` base class
- RestAssured dependency in build.gradle
- Base URI setup for RestAssured
- Exemption list pattern

**Gap:** CRITICAL — test exists but setup is incomplete. Generated project can't actually USE RestAssured.

### 1.3 Test Coverage Pairing

**Viafera:** `TestCoverageArchTest` — every Controller in `adapter.in.web` must have a corresponding `*ControllerIT`.

**Arbiter today:** Not generated.

**Gap:** MAJOR.

---

## Layer 2: Code Quality (Static Analysis)

### 2.1 Checkstyle

**Viafera:** `config/checkstyle/checkstyle.xml`:

- CyclomaticComplexity: max 15 (target 12)
- MethodLength: max 65 lines
- ParameterNumber: max 15 (target 7, currently 87 violations at 7)
- ClassFanOutComplexity: max 25
- FileTabCharacter, NewlineAtEndOfFile

**Gate:** HARD (maxWarnings=0).

**Arbiter today:** Does not generate Checkstyle config for Java.

**Gap:** CRITICAL for Java projects.

### 2.2 PMD

**Viafera:** `config/pmd/ruleset.xml` — 7 rule categories:

- DESIGN: CyclomaticComplexity (15), CognitiveComplexity (15), NcssCount (50/1000), TooManyMethods (20), TooManyFields (15), AvoidDeeplyNestedIfStmts (4), GodClass, ExcessiveImports (30)
- ERROR-PRONE: Full with 8 exclusions (framework patterns)
- MULTITHREADING: Full with 2 exclusions
- SECURITY: Full (no exclusions)
- BEST PRACTICES: Full with 8 exclusions
- PERFORMANCE: Full with 2 exclusions

**Gate:** HARD (ignoreFailures=false).

**Arbiter today:** Generates a generic `pmd-ruleset.xml` without precise rules.

**Gap:** CRITICAL — generic vs precise ruleset.

### 2.3 SpotBugs

**Viafera:** `config/spotbugs/exclude-filter.xml` (350 lines):

- CLASS-TARGETED suppressions (not blanket)
- Security patterns (SQL_INJECTION, XSS) NEVER suppressed
- Framework-related false positives (NP_NONNULL_FIELD, EI_EXPOSE_REP) narrowly suppressed

**Gate:** HARD (ignoreFailures=false).

**Arbiter today:** Not generated.

**Gap:** MAJOR for Java projects.

### 2.4 Spotless (Formatting)

**Viafera:** Google Java Format via Spotless plugin.

**Gate:** HARD (`gradle spotlessCheck` fails build).

**Arbiter today:** Assumes formatter exists but does not generate config.

**Gap:** MAJOR — should generate formatter config for all languages.

---

## Layer 3: Coverage & Mutation

### 3.1 JaCoCo

**Viafera:** `jacocoTestCoverageVerification` task:

- Line ≥ 80%, Branch ≥ 70%
- Exclusions: test classes, generated code, config
- Reports: HTML, XML, LCOV to `./coverage/`

**Gate:** HARD (build fails below threshold).

**Arbiter today:** Generates threshold in gate script but NOT JaCoCo plugin in build.gradle, NOT verification task.

**Gap:** CRITICAL — threshold without tool integration is incomplete.

### 3.2 Mutation Testing (PIT/Pitest)

**Viafera:** Pitest 1.15.0:

- Mutation threshold: ≥85%
- Coverage threshold: ≥90% (prerequisite)
- Target: `com.viafera.*.domain.*`, `*.application.service.*`, `*.application.usecase.*`
- Task: `gradle pitest`

**Gate:** HARD (build fails below threshold). Runs on L3 deep/nightly.

**Arbiter today:** Generates `pitest-setup.md` — a GUIDE, not a gate.

**Gap:** CRITICAL — advisory document vs hard gate. Must generate pitest plugin in build.gradle with thresholds.

---

## Layer 4: Testing Discipline

### 4.1 Test Pyramid (5 Levels)

**Viafera:**

- L1 Unit: framework-isolated, mocks OK
- L2 Architecture: ArchUnit, no mocks
- L3 Integration: Testcontainers (real PostgreSQL), WireMock for externals
- L4 E2E: Real Keycloak + Backend + DB (Playwright)
- L5 Security/Performance: Real everything

Controlled via JUnit `@Tag("unit")`, `@Tag("archunit")`, `@Tag("integration")`, `@Tag("gauntlet")`.

**Arbiter today:** Generates L1/L2/L3 in gate script but no @Tag filtering, no test pyramid enforcement.

**Gap:** MAJOR.

### 4.2 REAL-Only E2E (INV-26)

**Viafera:**

- E2E tests use REAL Keycloak, backend, PostgreSQL
- Mocking `/api/v1/*` throws runtime error (fail-fast)
- External providers MAY be mocked (weather, maps, payment)
- Evidence required: `.evidence/<run_id>/` with SUMMARY.json, obs_gate field

**Gate:** HARD. Mocking core API disqualifies test as E2E.

**Arbiter today:** Not generated.

**Gap:** MAJOR.

### 4.3 Behavioral Test Structure

**Viafera:** JUnit5 `@Nested` + `@DisplayName` for Given/When/Then structure. Frontend: `describe/it` with Vitest.

**Arbiter today:** Not generated (no template or guide for behavioral tests).

**Gap:** MAJOR.

### 4.4 Real Database Testing (INV-17)

**Viafera:** Testcontainers with PostgreSQL:

- `@Testcontainers` + `@Container PostgreSQLContainer`
- H2 explicitly forbidden
- Each test isolated with fresh container

**Arbiter today:** Not generated.

**Gap:** MAJOR.

### 4.5 Contract Testing (Pact)

**Viafera:** Pact consumer (frontend) + provider (backend):

- Frontend: `@pact-foundation/pact` generates consumer contracts
- Backend: `pact-jvm` verifies provider compliance
- CI: Contract verification job

**Arbiter today:** Not generated.

**Gap:** MAJOR (configurable — not all projects have APIs).

### 4.6 Evidence Harness

**Viafera:** `./viafera.sh e2e --full` produces:

```
.evidence/<YYYYMMDD-HHMMSS-sha>/
├── SUMMARY.md
├── SUMMARY.json (obs_gate: PASS|FAIL)
├── e2e-check.txt
├── playwright.txt
├── playwright-report/
└── logs/ (backend.log, keycloak.log, postgres.log)
```

**Gate:** HARD for L3. Missing evidence blocks nightly completion.

**Arbiter today:** Not generated.

**Gap:** MAJOR for L3 projects.

---

## Layer 5: Security

### 5.1 Dependency Audit (OWASP DependencyCheck)

**Viafera:** CVSS ≥ 7.0 fails build. `gradle dependencyCheckAnalyze`.

**Gate:** HARD (L1).

**Arbiter today:** Generated (M24). Per-stack: Java OWASP DC snippet (`config/owasp-dependency-check.gradle`, `apply from:`), TypeScript `npm audit`, Rust `cargo audit`, Go `govulncheck`, Python `pip-audit`. CI dep-audit step + local L2 gate. `soft: graceActive` honored.

**Gap:** Resolved (M24).

### 5.2 Secrets Detection (Gitleaks)

**Viafera:** `.gitleaks.toml`, scans git history.

**Gate:** Advisory (nightly), targeting HARD.

**Arbiter today:** Generated (M24). `.gitleaks.toml` emitted for all stacks. `security-early-fail` CI job (before `lint-and-test`). L2 gate step. Suppression baseline: `suppressions/.gitleaksignore`.

**Gap:** Resolved (M24).

### 5.3 PII Scan

**Viafera:** Custom regex, early-fail (JOB 00b in CI — before all other gates).

**Gate:** HARD.

**Arbiter today:** Generated (M24). `scripts/pii-scan.mjs` (email/phone/credit-card), HARD early-fail before L1 section in `check-all.mjs` (no grace period). `security-early-fail` CI job runs PII before all other CI jobs. Claude hook `check-no-pii.mjs` (PostToolUse). INV-12 broadened to cover code/tests/logs.

**Gap:** Resolved (M24).

### 5.4 Trivy Filesystem Scan

**Viafera:** `trivy fs --severity CRITICAL,HIGH --exit-code 1`.

**Gate:** Advisory (nightly, skippable).

**Arbiter today:** Not generated. Deferred to M25 (nightly pipeline). TODO(#73).

**Gap:** MINOR (M25).

---

## Layer 6: CI/Governance

### 6.1 Change Detection

**Viafera:** Path filters in CI determine which jobs run (docs_only, backend, frontend, high_risk).

**Arbiter today:** Not generated.

**Gap:** MAJOR for L2+.

### 6.2 Nightly Pipeline (L3)

**Viafera:** `nightly.yml` — E2E full, mutation, load, security deep scan. Delta mode skips L1+L2 if CI green.

**Arbiter today:** Not generated.

**Gap:** CRITICAL for L3.

### 6.3 SSOT Audit

**Viafera:** `ssot-core-check.sh` verifies GLOBAL_INVARIANTS, ENGINEERING_DEFAULTS, TESTING_POLICY consistency.

**Arbiter today:** Not generated.

**Gap:** MINOR.

---

## Layer 7: Frontend-Specific

### 7.1 ACL Boundary Enforcement

**Viafera:** `eslint-plugin-boundaries` + `no-restricted-imports`:

- UI/composables/stores/domain cannot import from `@/services/api`
- 4 purity rules (core R1, domain R2, application R3, composables/ui R4)

**Gate:** HARD.

**Arbiter today:** Not generated.

**Gap:** MAJOR for frontend projects.

### 7.2 Domain Purity

**Viafera:** `no-restricted-globals` in domain layer:

- Blocks: localStorage, sessionStorage, document, window, navigator, fetch

**Gate:** HARD.

**Arbiter today:** Not generated.

**Gap:** MAJOR.

### 7.3 Playwright Quality Rules

**Viafera:** `eslint-plugin-playwright`:

- no-force-option, no-wait-for-timeout, no-page-pause (HARD)
- prefer-web-first-assertions (warn)

**Arbiter today:** Not generated.

**Gap:** MAJOR.

---

## Layer 8: Database

### 8.1 Versioned Migrations

**Viafera:** Flyway 12.2.0, forward-only `V<number>__<description>.sql`.

**Gate:** HARD (startup fails on validation error).

**Arbiter today:** Mentioned in invariants but not generated.

**Gap:** MAJOR.

---

## Gap Summary

| Severity     | Count | Items                                                                                                                                                               |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** | 7     | ArchUnit full suite, RestAssured setup, Mutation testing as gate, Security scanning, Nightly L3, PMD precise ruleset, JaCoCo tool integration                       |
| **MAJOR**    | 9     | Evidence harness, Testcontainers, Contract testing, PII scan, Change detection, Frontend boundaries, Real-only E2E, Behavioral test template, Test coverage pairing |
| **MINOR**    | 5     | Spotless config, SpotBugs, Slot isolation, No-style enforcement, SSOT audit                                                                                         |

---

## Milestone Mapping

Each gap maps to a planned milestone:

| Gap                                                         | Milestone |
| ----------------------------------------------------------- | --------- |
| ArchUnit full suite + RestAssured setup                     | M22       |
| Mutation testing as hard gate                               | M23       |
| Security scanning (dep audit, secrets, PII)                 | M24       |
| Nightly pipeline + evidence harness                         | M25       |
| Real database testing (Testcontainers)                      | M26       |
| Behavioral test structure + test quality                    | M27       |
| Contract testing (Pact)                                     | M28       |
| Static analysis suite (Checkstyle, PMD, SpotBugs, Spotless) | M29       |
| Coverage tool integration (JaCoCo in build tool)            | M30       |
| Configuration skill + arbiter.json v2                       | M31       |
| Extended AI tool support                                    | M32       |

See `MILESTONES.md` for full milestone definitions.
