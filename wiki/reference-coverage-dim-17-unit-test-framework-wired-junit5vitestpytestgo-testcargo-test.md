---
generated: true
source: 'docs/REFERENCE/coverage/dim-17-unit-test-framework-wired-junit5vitestpytestgo-testcargo-test.md'
source_sha: '193b4055bc80ef3bec89980ff62f8d794153275f'
last_updated: '2026-06-08'
---

# N17: Unit test framework wired (JUnit5/Vitest/pytest/go test/cargo test)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-17-unit-test-framework-wired-junit5vitestpytestgo-testcargo-test.md](../docs/REFERENCE/coverage/dim-17-unit-test-framework-wired-junit5vitestpytestgo-testcargo-test.md)

<!-- arbiter-generated dim=N17 hash=47841681e05f25d6fde6e40525c1b56aff16852eb30fb8815243c81d43f6812f generator=kit@1 -->

# N17: Unit test framework wired (JUnit5/Vitest/pytest/go test/cargo test)

| Field    | Value          |
| -------- | -------------- |
| TML      | L1             |
| Gate     | BLOCKING       |
| Status   | covered        |
| Category | test_framework |

## Notes

Each stack has a canonical unit test runner wired into L1 gate

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
