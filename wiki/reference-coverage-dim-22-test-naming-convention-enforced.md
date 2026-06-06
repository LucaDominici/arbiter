---
generated: true
source: 'docs/REFERENCE/coverage/dim-22-test-naming-convention-enforced.md'
source_sha: '1bb64072305373674023a527cdfdc4dce51f387d'
last_updated: '2026-06-06'
---

# N22: Test naming convention enforced

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-22-test-naming-convention-enforced.md](../docs/REFERENCE/coverage/dim-22-test-naming-convention-enforced.md)

<!-- arbiter-generated dim=N22 hash=9276d299efa4f4d85415c82f76a0588224a288c2988734d8a3ce098d052dd974 generator=kit@1 -->

# N22: Test naming convention enforced

| Field     | Value          |
| --------- | -------------- |
| TML       | L1             |
| Gate      | BLOCKING       |
| Status    | covered        |
| Category  | test_framework |
| Invariant | `INV-06`       |

## Notes

check-test-naming.mjs enforces naming contract at L1

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
