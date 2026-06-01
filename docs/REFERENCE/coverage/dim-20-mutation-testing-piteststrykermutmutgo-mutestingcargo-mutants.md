---
title: "N20: Mutation testing (pitest/stryker/mutmut/go-mutesting/cargo-mutants)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N20 hash=4680fefa933c21e0d9607b5b81fc10decb5c3c55ea083777041a1e0dff67a343 generator=kit@1 -->
# N20: Mutation testing (pitest/stryker/mutmut/go-mutesting/cargo-mutants)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | test_framework |
| Invariant | `INV-29` |

## Notes

INV-29 enforces mutation score threshold; tooling wired per stack at L3

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: jacoco (via coverage) |
| `typescript` | tool: vitest/c8 (via coverage) |
| `python` | tool: pytest-cov (via coverage) |
| `go` | tool: go test -cover (via coverage) |
| `rust` | tool: cargo-tarpaulin (via coverage) |

