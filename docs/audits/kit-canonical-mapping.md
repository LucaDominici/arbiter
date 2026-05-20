---
title: KIT Canonical Mapping
type: audit
status: CURRENT
date: 2026-05-19
source: /home/luca/tools/KIT_gold-standard_76-dimensions_REDACTED.xlsx
revision: Rev00 07/05/2026
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# KIT Canonical Mapping — 76 Dimensions × Arbiter Targets

> Machine-readable source: `docs/audits/kit-canonical-mapping.json`
> TML notation: M1/M2/M3 = arbiter canonical (XLSX uses L1/L2/L3). ADR-045.
> Gate types enumerated in: `docs/REFERENCE/external-kit-sources.md`

| #   | Category           | Dimension                                               | TML | Gate Type                       | Stack       | Conditional | Implementing Wave | Arbiter Target Kind | Disposition     |
| --- | ------------------ | ------------------------------------------------------- | --- | ------------------------------- | ----------- | ----------- | ----------------- | ------------------- | --------------- |
| 1   | Architecture       | ArchUnit rules compile-time                             | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 2   | Architecture       | Interface + Impl pattern (P5)                           | M2  | `BLOCKING (ArchUnit R-19)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 3   | Architecture       | Bean Validation @Valid (P8)                             | M2  | `BLOCKING (ArchUnit R-21)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 4   | Architecture       | API versioning /v1/ (P12)                               | M2  | `BLOCKING (ArchUnit R-8..R-10)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 5   | Architecture       | DTO in package dto/ (P17-P19)                           | M2  | `BLOCKING (ArchUnit R-16,R-23)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 6   | Architecture       | Constructor injection (P7)                              | M2  | `BLOCKING (ArchUnit R-15)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 7   | Architecture       | Exception hierarchy RFC 7807 (P15)                      | M2  | `BLOCKING (ArchUnit R-7,R-13)`  | java_spring | —           | F2                | adapter             | stack-adapter   |
| 8   | Architecture       | @Async + TenantAwareTaskDecorator (P20)                 | M2  | `BLOCKING (ArchUnit R-11,R-12)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 9   | Static Analysis    | JaCoCo coverage gate                                    | M1  | `BLOCKING (L2+)`                | java_spring | —           | F2                | adapter             | stack-adapter   |
| 10  | Static Analysis    | Spotless formatting                                     | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 11  | Static Analysis    | SpotBugs bug detection                                  | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 12  | Static Analysis    | PMD code quality                                        | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 13  | Static Analysis    | Checkstyle style enforcement                            | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 14  | Static Analysis    | PITest mutation testing                                 | M3  | `BLOCKING (nightly)`            | java_spring | —           | F2                | adapter             | stack-adapter   |
| 15  | Static Analysis    | OWASP dependency-check                                  | M2  | `BLOCKING (nightly)`            | agnostic    | —           | W9                | workflow            | adopt-framework |
| 16  | Static Analysis    | CycloneDX SBOM                                          | M3  | `ADVISORY`                      | agnostic    | —           | W9                | workflow            | adopt-framework |
| 17  | Test Framework     | JUnit 5 + Spring Boot Test                              | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 18  | Test Framework     | REST Assured integration tests                          | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 19  | Test Framework     | Testcontainers PostgreSQL                               | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 20  | Test Framework     | Testcontainers MariaDB + MSSQL                          | M3  | `ADVISORY`                      | java_spring | crossdb     | F2                | adapter             | stack-adapter   |
| 21  | Test Framework     | Testcontainers Toxiproxy                                | M3  | `ADVISORY`                      | java_spring | concurrent  | F2                | adapter             | stack-adapter   |
| 22  | Test Framework     | Swagger Request Validator                               | M3  | `BLOCKING (-Pcontract)`         | java_spring | —           | F2                | adapter             | stack-adapter   |
| 23  | Test Framework     | Base test infrastructure                                | M2  | `REFERENCE`                     | java_spring | —           | F2                | adapter             | stack-adapter   |
| 24  | Test Profiles      | Surefire profiles Maven                                 | M2  | `REFERENCE`                     | java_spring | —           | F2                | adapter             | stack-adapter   |
| 25  | Test Profiles      | @Tag taxonomy (25 tags)                                 | M3  | `BLOCKING (ArchUnit)`           | agnostic    | —           | W7                | doc                 | adopt-framework |
| 26  | Test Profiles      | run.sh orchestrator                                     | M1  | `REFERENCE`                     | agnostic    | —           | W3                | script              | adopt-self      |
| 27  | Test Types         | Unit tests                                              | M1  | `BLOCKING (L2+)`                | agnostic    | —           | W7                | doc                 | adopt-framework |
| 28  | Test Types         | Behavioral tests (happy path)                           | M3  | `BLOCKING (-Pbehavioral)`       | agnostic    | —           | W7                | doc                 | adopt-framework |
| 29  | Test Types         | Edge-case tests (boundary)                              | M3  | `BLOCKING (-Pedge-case)`        | agnostic    | —           | W7                | doc                 | adopt-framework |
| 30  | Test Types         | Contract tests (OpenAPI)                                | M3  | `BLOCKING (-Pcontract)`         | template    | contract    | F7                | template            | adopt-framework |
| 31  | Test Types         | Concurrent/stress tests                                 | M3  | `ADVISORY`                      | agnostic    | —           | W7                | doc                 | adopt-framework |
| 32  | Test Types         | Migration tests (Liquibase rollback)                    | M3  | `ADVISORY`                      | java_spring | crossdb     | F2                | adapter             | stack-adapter   |
| 33  | Test Types         | Performance Surefire tests                              | M3  | `ADVISORY`                      | agnostic    | —           | W7                | doc                 | adopt-framework |
| 34  | CI/CD              | build.yml multi-stage                                   | M2  | `BLOCKING`                      | agnostic    | —           | W4                | workflow            | adopt-framework |
| 35  | CI/CD              | Quality gates job (bash scripts)                        | M2  | `BLOCKING`                      | agnostic    | —           | W4                | workflow            | adopt-framework |
| 36  | CI/CD              | Nightly pipeline                                        | M3  | `BLOCKING (nightly)`            | agnostic    | —           | W10               | workflow            | adopt-framework |
| 37  | CI/CD              | Ship stage (Docker+Trivy+{{CONTAINER_REGISTRY}}+deploy) | M3  | `BLOCKING`                      | agnostic    | —           | W9                | workflow            | adopt-framework |
| 38  | CI/CD              | issue-state.yml automation                              | M3  | `ADVISORY`                      | agnostic    | —           | W8                | workflow            | adopt-framework |
| 39  | CI/CD              | Load test workflows                                     | M3  | `ADVISORY`                      | agnostic    | —           | F6                | workflow            | adopt-framework |
| 40  | CI/CD              | Newman CI integration                                   | M3  | `BLOCKING`                      | agnostic    | —           | F7                | workflow            | adopt-framework |
| 41  | E2E & Perf         | Newman/Postman E2E collection                           | M3  | `BLOCKING (CI)`                 | template    | —           | F7                | template            | adopt-framework |
| 42  | E2E & Perf         | k6 load test suite                                      | M3  | `BLOCKING (nightly)`            | template    | —           | F6                | template            | adopt-framework |
| 43  | E2E & Perf         | k6 endurance test (30min)                               | M3  | `ADVISORY`                      | template    | —           | F6                | template            | adopt-framework |
| 44  | E2E & Perf         | DAST (ZAP authenticated)                                | M3  | `ADVISORY`                      | template    | —           | F8                | template            | adopt-framework |
| 45  | Scripts Validation | validate-mybatis-xml-crud.sh                            | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 46  | Scripts Validation | validate-schema-isolation.sh                            | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 47  | Scripts Validation | validate-liquibase-naming.sh + crossdb.sh               | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 48  | Scripts Validation | validate-postman-collection.sh                          | M3  | `BLOCKING`                      | template    | contract    | F7                | template            | adopt-framework |
| 49  | Scripts Validation | validate-nightly-k6.sh + post-run + workflow            | M3  | `BLOCKING`                      | template    | —           | F6                | template            | adopt-framework |
| 50  | Scripts Validation | check-drift.py                                          | M3  | `ADVISORY`                      | agnostic    | —           | W6                | script              | adopt-self      |
| 51  | Scripts Quality    | quality-check.sh (aggregated)                           | M2  | `ADVISORY`                      | agnostic    | —           | W6                | script              | adopt-self      |
| 52  | Scripts Quality    | coverage-report.sh + arch-verify.sh                     | M2  | `ADVISORY`                      | agnostic    | —           | W6                | script              | adopt-self      |
| 53  | Scripts Quality    | format-fix.sh + security-scan.sh                        | M2  | `ADVISORY`                      | agnostic    | —           | W6                | script              | adopt-self      |
| 54  | Scripts Quality    | pii-scan.sh                                             | M1  | `ADVISORY`                      | agnostic    | —           | W6                | script              | adopt-self      |
| 55  | Security           | Gitleaks pre-commit hook                                | M1  | `BLOCKING (locale)`             | agnostic    | —           | W6                | hook                | adopt-self      |
| 56  | Security           | SecurityConfig hardening                                | M3  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 57  | Security           | .trivyignore + .zap/rules.tsv                           | M3  | `REFERENCE`                     | agnostic    | —           | W9                | template            | adopt-framework |
| 58  | Security           | Docker build-args safety                                | M3  | `BLOCKING`                      | agnostic    | —           | W9                | template            | adopt-framework |
| 59  | Git & GitHub       | Git hooks (.githooks/ 3 hooks)                          | M1  | `BLOCKING (locale)`             | agnostic    | —           | DONE              | template            | done            |
| 60  | Git & GitHub       | GitHub issue templates (3 types)                        | M1  | `ADVISORY`                      | agnostic    | —           | W4                | template            | adopt-framework |
| 61  | Git & GitHub       | GitHub PR template                                      | M1  | `ADVISORY`                      | agnostic    | —           | W8                | template            | adopt-framework |
| 62  | Git & GitHub       | .editorconfig                                           | M1  | `REFERENCE`                     | agnostic    | —           | DONE              | template            | done            |
| 63  | Documentation      | docs/coding-standards.md                                | M2  | `REFERENCE`                     | agnostic    | —           | DONE              | doc                 | done            |
| 64  | Documentation      | docs/testing/ (3 file)                                  | M3  | `REFERENCE`                     | agnostic    | —           | W7                | doc                 | adopt-framework |
| 65  | Documentation      | docs/adr/ (>=5 ADR)                                     | M3  | `REFERENCE`                     | agnostic    | —           | DONE              | doc                 | done            |
| 66  | Documentation      | docs/security/ (2 file)                                 | M3  | `REFERENCE`                     | agnostic    | —           | DONE              | doc                 | done            |
| 67  | Documentation      | docs/api/ (OpenAPI + Postman + env)                     | M3  | `BLOCKING (contract)`           | agnostic    | —           | F9                | doc                 | adopt-framework |
| 68  | Documentation      | Runbooks + support docs                                 | M3  | `REFERENCE`                     | agnostic    | —           | DONE              | doc                 | done            |
| 69  | Configuration      | CLAUDE.md with P1-P28                                   | M1  | `REFERENCE`                     | agnostic    | —           | DONE              | doc                 | done            |
| 70  | Configuration      | .env example files                                      | M3  | `REFERENCE`                     | agnostic    | —           | W3                | template            | adopt-framework |
| 71  | Configuration      | Seed data scripts                                       | M3  | `REFERENCE`                     | java_spring | —           | F2                | adapter             | stack-adapter   |
| 72  | Configuration      | Spring Boot version alignment                           | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 73  | Audit Trail \*     | audit_event table + DB triggers                         | M3  | `BLOCKING (pharma)`             | java_spring | pharma      | F5                | adapter             | stack-adapter   |
| 74  | Audit Trail \*     | AuditEventService + AuditEventMapper                    | M3  | `BLOCKING (pharma)`             | java_spring | pharma      | F5                | adapter             | stack-adapter   |
| 75  | Audit Trail \*     | ArchUnit R-36/R-38/R-39                                 | M3  | `BLOCKING (pharma)`             | java_spring | pharma      | F5                | adapter             | stack-adapter   |
| 76  | Documentation      | docs/ci/README.md -- CI/CD Developer Reference          | M2  | `REFERENCE`                     | agnostic    | —           | W4                | doc                 | adopt-framework |

---

## By Implementing Wave

### DONE (4 dims)

- **59** Git hooks (.githooks/ 3 hooks) (agnostic, M1, BLOCKING (locale))
- **62** .editorconfig (agnostic, M1, REFERENCE)
- **65** docs/adr/ (>=5 ADR) (agnostic, M3, REFERENCE)
- **69** CLAUDE.md with P1-P28 (agnostic, M1, REFERENCE)

### W3 (2 dims)

- **26** run.sh orchestrator (agnostic, M1, REFERENCE)
- **70** .env example files (agnostic, M3, REFERENCE)

### W4 (4 dims)

- **34** build.yml multi-stage (agnostic, M2, BLOCKING)
- **35** Quality gates job (bash scripts) (agnostic, M2, BLOCKING)
- **60** GitHub issue templates (3 types) (agnostic, M1, ADVISORY)
- **76** docs/ci/README.md -- CI/CD Developer Reference (agnostic, M2, REFERENCE)

### W6 (6 dims)

- **50** check-drift.py (agnostic, M3, ADVISORY)
- **51** quality-check.sh (aggregated) (agnostic, M2, ADVISORY)
- **52** coverage-report.sh + arch-verify.sh (agnostic, M2, ADVISORY)
- **53** format-fix.sh + security-scan.sh (agnostic, M2, ADVISORY)
- **54** pii-scan.sh (agnostic, M1, ADVISORY)
- **55** Gitleaks pre-commit hook (agnostic, M1, BLOCKING (locale))

### W7 (7 dims)

- **25** @Tag taxonomy (25 tags) (agnostic, M3, BLOCKING (ArchUnit))
- **27** Unit tests (agnostic, M1, BLOCKING (L2+))
- **28** Behavioral tests (happy path) (agnostic, M3, BLOCKING (-Pbehavioral))
- **29** Edge-case tests (boundary) (agnostic, M3, BLOCKING (-Pedge-case))
- **31** Concurrent/stress tests (agnostic, M3, ADVISORY)
- **33** Performance Surefire tests (agnostic, M3, ADVISORY)
- **64** docs/testing/ (3 file) (agnostic, M3, REFERENCE)

### W8 (2 dims)

- **38** issue-state.yml automation (agnostic, M3, ADVISORY)
- **61** GitHub PR template (agnostic, M1, ADVISORY)

### W9 (5 dims)

- **15** OWASP dependency-check (agnostic, M2, BLOCKING (nightly))
- **16** CycloneDX SBOM (agnostic, M3, ADVISORY)
- **37** Ship stage (Docker+Trivy+{{CONTAINER_REGISTRY}}+deploy) (agnostic, M3, BLOCKING)
- **57** .trivyignore + .zap/rules.tsv (agnostic, M3, REFERENCE)
- **58** Docker build-args safety (agnostic, M3, BLOCKING)

### W10 (1 dim)

- **36** Nightly pipeline (agnostic, M3, BLOCKING (nightly))

### F2 (29 dims)

- **1** ArchUnit rules compile-time (java_spring, M2, BLOCKING)
- **2** Interface + Impl pattern (P5) (java_spring, M2, BLOCKING (ArchUnit R-19))
- **3** Bean Validation @Valid (P8) (java_spring, M2, BLOCKING (ArchUnit R-21))
- **4** API versioning /v1/ (P12) (java_spring, M2, BLOCKING (ArchUnit R-8..R-10))
- **5** DTO in package dto/ (P17-P19) (java_spring, M2, BLOCKING (ArchUnit R-16,R-23))
- **6** Constructor injection (P7) (java_spring, M2, BLOCKING (ArchUnit R-15))
- **7** Exception hierarchy RFC 7807 (P15) (java_spring, M2, BLOCKING (ArchUnit R-7,R-13))
- **8** @Async + TenantAwareTaskDecorator (P20) (java_spring, M2, BLOCKING (ArchUnit R-11,R-12))
- **9** JaCoCo coverage gate (java_spring, M1, BLOCKING (L2+))
- **10** Spotless formatting (java_spring, M1, BLOCKING)
- **11** SpotBugs bug detection (java_spring, M2, BLOCKING)
- **12** PMD code quality (java_spring, M2, BLOCKING)
- **13** Checkstyle style enforcement (java_spring, M2, BLOCKING)
- **14** PITest mutation testing (java_spring, M3, BLOCKING (nightly))
- **17** JUnit 5 + Spring Boot Test (java_spring, M1, BLOCKING)
- **18** REST Assured integration tests (java_spring, M2, BLOCKING)
- **19** Testcontainers PostgreSQL (java_spring, M2, BLOCKING)
- **20** Testcontainers MariaDB + MSSQL (java_spring, M3, ADVISORY)
- **21** Testcontainers Toxiproxy (java_spring, M3, ADVISORY)
- **22** Swagger Request Validator (java_spring, M3, BLOCKING (-Pcontract))
- **23** Base test infrastructure (java_spring, M2, REFERENCE)
- **24** Surefire profiles Maven (java_spring, M2, REFERENCE)
- **32** Migration tests (Liquibase rollback) (java_spring, M3, ADVISORY)
- **45** validate-mybatis-xml-crud.sh (java_spring, M1, BLOCKING)
- **46** validate-schema-isolation.sh (java_spring, M1, BLOCKING)
- **47** validate-liquibase-naming.sh + crossdb.sh (java_spring, M2, BLOCKING)
- **56** SecurityConfig hardening (java_spring, M3, BLOCKING)
- **71** Seed data scripts (java_spring, M3, REFERENCE)
- **72** Spring Boot version alignment (java_spring, M1, BLOCKING)

### F5 (3 dims)

- **73** audit_event table + DB triggers (java_spring, M3, BLOCKING (pharma))
- **74** AuditEventService + AuditEventMapper (java_spring, M3, BLOCKING (pharma))
- **75** ArchUnit R-36/R-38/R-39 (java_spring, M3, BLOCKING (pharma))

### F6 (4 dims)

- **39** Load test workflows (agnostic, M3, ADVISORY)
- **42** k6 load test suite (template, M3, BLOCKING (nightly))
- **43** k6 endurance test (30min) (template, M3, ADVISORY)
- **49** validate-nightly-k6.sh + post-run + workflow (template, M3, BLOCKING)

### F7 (4 dims)

- **30** Contract tests (OpenAPI) (template, M3, BLOCKING (-Pcontract))
- **40** Newman CI integration (agnostic, M3, BLOCKING)
- **41** Newman/Postman E2E collection (template, M3, BLOCKING (CI))
- **48** validate-postman-collection.sh (template, M3, BLOCKING)

### F8 (1 dim)

- **44** DAST (ZAP authenticated) (template, M3, ADVISORY)

### F9 (1 dim)

- **67** docs/api/ (OpenAPI + Postman + env) (agnostic, M3, BLOCKING (contract))

### F12 (3 dims) — DONE (#897)

- **63** docs/coding-standards.md (agnostic, M2, REFERENCE) — DONE
- **66** docs/security/ (2 file) (agnostic, M3, REFERENCE) — DONE
- **68** Runbooks + support docs (agnostic, M3, REFERENCE) — DONE

---

## Coverage Summary

| Scope                       | Count |
| --------------------------- | ----- |
| Total dims                  | 76    |
| Java-specific (java_spring) | 32    |
| Stack-agnostic              | 37    |
| Template-only               | 7     |
| Already DONE in arbiter     | 4     |
| F2 java adapter             | 29    |
| F5 pharma overlay           | 3     |
