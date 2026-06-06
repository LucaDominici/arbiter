---
generated: true
source: 'docs/REFERENCE/coverage/dim-18-code-coverage-gate-jacocov8coveragepygo-covercargo-tarpaulin.md'
source_sha: '96c789f246d959b8c89d945c3a9afaa9282ed7fc'
last_updated: '2026-06-06'
---

# N18: Code coverage gate (JaCoCo/V8/coverage.py/go cover/cargo-tarpaulin)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-18-code-coverage-gate-jacocov8coveragepygo-covercargo-tarpaulin.md](../docs/REFERENCE/coverage/dim-18-code-coverage-gate-jacocov8coveragepygo-covercargo-tarpaulin.md)

<!-- arbiter-generated dim=N18 hash=9c063d57a156e354b822cdd7bc2e1fcd926ff1f5d0029ed2cefecc728a2b9e05 generator=kit@1 -->

# N18: Code coverage gate (JaCoCo/V8/coverage.py/go cover/cargo-tarpaulin)

| Field    | Value          |
| -------- | -------------- |
| TML      | L2             |
| Gate     | BLOCKING       |
| Status   | covered        |
| Category | test_framework |

## Notes

Coverage threshold enforced at L2; arbiter default 85% lines, kit baseline 80%

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
