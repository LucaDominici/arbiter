---
generated: true
source: 'docs/REFERENCE/coverage/dim-23-test-tdd-evidence-captured-w4-protocol.md'
source_sha: 'baa9eb43db855b0d91561210c4310156c052ea8f'
last_updated: '2026-06-08'
---

# N23: Test TDD evidence captured (W4 protocol)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-23-test-tdd-evidence-captured-w4-protocol.md](../docs/REFERENCE/coverage/dim-23-test-tdd-evidence-captured-w4-protocol.md)

<!-- arbiter-generated dim=N23 hash=c9f644200e545ba50ffdbeebb60ceff3fe3a335db26ca55cfe8d4859013b7e0f generator=kit@1 -->

# N23: Test TDD evidence captured (W4 protocol)

| Field    | Value          |
| -------- | -------------- |
| TML      | L2             |
| Gate     | ADVISORY       |
| Status   | partial        |
| Category | test_framework |

## Notes

W4 TDD evidence under .arbiter/evidence/tdd/; enforced by check-tdd-evidence.mjs at L2

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
