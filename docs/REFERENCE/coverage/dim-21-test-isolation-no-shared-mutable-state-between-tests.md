---
title: "N21: Test isolation — no shared mutable state between tests"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N21 hash=e29ef29c91b8c6a1f226cf1719c4105ff432da46b3aad71e9bb54895c4cab2c7 generator=kit@1 -->
# N21: Test isolation — no shared mutable state between tests

| Field | Value |
|---|---|
| TML | L1 |
| Gate | BLOCKING |
| Status | partial |
| Category | test_framework |

## Notes

Enforced by test framework config (vitest pool isolation, JUnit @DirtiesContext)

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: jacoco (via coverage) |
| `typescript` | tool: vitest/c8 (via coverage) |
| `python` | tool: pytest-cov (via coverage) |
| `go` | tool: go test -cover (via coverage) |
| `rust` | tool: cargo-tarpaulin (via coverage) |

