---
generated: true
source: 'docs/REFERENCE/coverage/dim-21-test-isolation-no-shared-mutable-state-between-tests.md'
source_sha: 'cefd43a555037a198fb95fa0a5bf66ff3a20537b'
last_updated: '2026-06-08'
---

# N21: Test isolation — no shared mutable state between tests

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-21-test-isolation-no-shared-mutable-state-between-tests.md](../docs/REFERENCE/coverage/dim-21-test-isolation-no-shared-mutable-state-between-tests.md)

<!-- arbiter-generated dim=N21 hash=e29ef29c91b8c6a1f226cf1719c4105ff432da46b3aad71e9bb54895c4cab2c7 generator=kit@1 -->

# N21: Test isolation — no shared mutable state between tests

| Field    | Value          |
| -------- | -------------- |
| TML      | L1             |
| Gate     | BLOCKING       |
| Status   | partial        |
| Category | test_framework |

## Notes

Enforced by test framework config (vitest pool isolation, JUnit @DirtiesContext)

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
