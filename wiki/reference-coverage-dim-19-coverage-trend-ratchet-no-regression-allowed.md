---
generated: true
source: 'docs/REFERENCE/coverage/dim-19-coverage-trend-ratchet-no-regression-allowed.md'
source_sha: 'f965102eb44baa8490f0f85bd9fccc8c017e9944'
last_updated: '2026-06-06'
---

# N19: Coverage trend ratchet (no regression allowed)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-19-coverage-trend-ratchet-no-regression-allowed.md](../docs/REFERENCE/coverage/dim-19-coverage-trend-ratchet-no-regression-allowed.md)

<!-- arbiter-generated dim=N19 hash=5997212966b55afaee9d7008fd428de4305c554a1850b2da53ae282ec1f5634f generator=kit@1 -->

# N19: Coverage trend ratchet (no regression allowed)

| Field    | Value          |
| -------- | -------------- |
| TML      | L2             |
| Gate     | BLOCKING       |
| Status   | covered        |
| Category | test_framework |

## Notes

Coverage baseline ratchet prevents regressions across PRs

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
