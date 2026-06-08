---
generated: true
source: 'docs/REFERENCE/coverage/dim-20-mutation-testing-piteststrykermutmutgo-mutestingcargo-mutants.md'
source_sha: '3a635cacb50661bbd71c79862a44d1f70e33437f'
last_updated: '2026-06-08'
---

# N20: Mutation testing (pitest/stryker/mutmut/go-mutesting/cargo-mutants)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-20-mutation-testing-piteststrykermutmutgo-mutestingcargo-mutants.md](../docs/REFERENCE/coverage/dim-20-mutation-testing-piteststrykermutmutgo-mutestingcargo-mutants.md)

<!-- arbiter-generated dim=N20 hash=4680fefa933c21e0d9607b5b81fc10decb5c3c55ea083777041a1e0dff67a343 generator=kit@1 -->

# N20: Mutation testing (pitest/stryker/mutmut/go-mutesting/cargo-mutants)

| Field     | Value          |
| --------- | -------------- |
| TML       | L3             |
| Gate      | ADVISORY       |
| Status    | partial        |
| Category  | test_framework |
| Invariant | `INV-29`       |

## Notes

INV-29 enforces mutation score threshold; tooling wired per stack at L3

## Per-Stack Coverage

| Stack        | Kind                                 |
| ------------ | ------------------------------------ |
| `java`       | tool: jacoco (via coverage)          |
| `typescript` | tool: vitest/c8 (via coverage)       |
| `python`     | tool: pytest-cov (via coverage)      |
| `go`         | tool: go test -cover (via coverage)  |
| `rust`       | tool: cargo-tarpaulin (via coverage) |
