---
generated: true
source: 'docs/audits/kit-canonical-mapping.md'
source_sha: '3bb150bc460bc9b73a3d732cd127e604ebb9d8ae'
last_updated: '2026-06-08'
---

# KIT Canonical Mapping

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/audits/kit-canonical-mapping.md](../docs/audits/kit-canonical-mapping.md)

# KIT Canonical Mapping — 76 Dimensions × Arbiter Targets

> Machine-readable source: `docs/audits/kit-canonical-mapping.json`
> TML notation: M1/M2/M3 = arbiter canonical (XLSX uses L1/L2/L3). ADR-045.
> Gate types enumerated in: `docs/REFERENCE/external-kit-sources.md`

| #   | Category        | Dimension                               | TML | Gate Type                       | Stack       | Conditional | Implementing Wave | Arbiter Target Kind | Disposition     |
| --- | --------------- | --------------------------------------- | --- | ------------------------------- | ----------- | ----------- | ----------------- | ------------------- | --------------- |
| 1   | Architecture    | ArchUnit rules compile-time             | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 2   | Architecture    | Interface + Impl pattern (P5)           | M2  | `BLOCKING (ArchUnit R-19)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 3   | Architecture    | Bean Validation @Valid (P8)             | M2  | `BLOCKING (ArchUnit R-21)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 4   | Architecture    | API versioning /v1/ (P12)               | M2  | `BLOCKING (ArchUnit R-8..R-10)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 5   | Architecture    | DTO in package dto/ (P17-P19)           | M2  | `BLOCKING (ArchUnit R-16,R-23)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 6   | Architecture    | Constructor injection (P7)              | M2  | `BLOCKING (ArchUnit R-15)`      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 7   | Architecture    | Exception hierarchy RFC 7807 (P15)      | M2  | `BLOCKING (ArchUnit R-7,R-13)`  | java_spring | —           | F2                | adapter             | stack-adapter   |
| 8   | Architecture    | @Async + TenantAwareTaskDecorator (P20) | M2  | `BLOCKING (ArchUnit R-11,R-12)` | java_spring | —           | F2                | adapter             | stack-adapter   |
| 9   | Static Analysis | JaCoCo coverage gate                    | M1  | `BLOCKING (L2+)`                | java_spring | —           | F2                | adapter             | stack-adapter   |
| 10  | Static Analysis | Spotless formatting                     | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 11  | Static Analysis | SpotBugs bug detection                  | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 12  | Static Analysis | PMD code quality                        | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 13  | Static Analysis | Checkstyle style enforcement            | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 14  | Static Analysis | PITest mutation testing                 | M3  | `BLOCKING (nightly)`            | java_spring | —           | F2                | adapter             | stack-adapter   |
| 15  | Static Analysis | OWASP dependency-check                  | M2  | `BLOCKING (nightly)`            | agnostic    | —           | W9                | workflow            | adopt-framework |
| 16  | Static Analysis | CycloneDX SBOM                          | M3  | `ADVISORY`                      | agnostic    | —           | W9                | workflow            | adopt-framework |
| 17  | Test Framework  | JUnit 5 + Spring Boot Test              | M1  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 18  | Test Framework  | REST Assured integration tests          | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 19  | Test Framework  | Testcontainers PostgreSQL               | M2  | `BLOCKING`                      | java_spring | —           | F2                | adapter             | stack-adapter   |
| 20  | Test Framework  | Testcontainers MariaDB + MSSQL          | M3  | `ADVISORY`                      | java_spring | crossdb     | F2                | adapter             | stack-adapter   |
| 21  | Test Framework  | Testcontainers Toxiproxy                | M3  | `ADVISORY`                      | java_spring | concurrent  | F2                | adapter             | stack-adapter   |
| 22  | Test Framework  | Swagger Request Validator               | M3  | `BLOCKING (-Pcontract)`         | java_spring | —           | F2                | adapter             | stack-adapter   |
| 23  | Test Framework  | Base test infrastructure                | M2  | `REFERENCE`                     | java_spring | —           | F2                | adapter             | stack-adapter   |
| 24  | Test Profiles   | Surefire profiles Maven                 | M2  | `REFERENCE`                     | java_spring | —           | F2                | adapter             | stack-adapter   |
| 25  | Test Profiles   | @Tag taxonomy (25 tags)                 | M3  | `BLOCKING (ArchUnit)`           | agnostic    | —           | W7                | doc                 | adopt-framework |
| 26  | Test Profiles   | run.sh orchestrator                     | M1  | `REFERENCE`                     | agnostic    | —           | W3                | script              | adopt-self      |
| 27  | Test Types      | Unit tests                              | M1  | `BLOCKING (L2+)`                | agnostic    | —           | W7                | doc                 | adopt-framework |
| 28  | Test Types      | Behavioral tests (happy path)           | M3  | `BLOCKING (-Pbehavioral)`       | agnostic    | —           | W7                | doc                 | adopt-framework |
| 29  | Test Types      | Edge-case tests (boundary)              | M3  | `BLOCKING (-Pedge-case)`        | agnostic    | —           | W7                | doc                 | adopt-framework |
| 30  | Test Types      | Contract tests (OpenAPI)                | M3  | `BLOCKING (-Pcontract)`         | template    | contract    | F7                | template            | adopt-framework |
| 31  | Test Types      | Concurrent/stress tests                 | M3  | `ADVISORY`                      | agnostic    | —           | W7                | doc                 | adopt-framework |
| 32  | Test Types      | Migration tests (Liquibase rollback)    | M3  | `ADVISORY`                      | java_spring | crossdb     | F2                | adapter             | stack-adapter   |
| 33  | Test Types      | Performance Surefire tests              | M3  | `ADVISORY`                      | agnostic    | —           | W7                | doc                 | adopt-framework |
| 34  | CI/CD           | build.yml multi-stage                   | M2  | `BLOCKING`                      | agnostic    | —           | W4                | workflow            | adopt           |

_[content truncated — see source for full text]_
