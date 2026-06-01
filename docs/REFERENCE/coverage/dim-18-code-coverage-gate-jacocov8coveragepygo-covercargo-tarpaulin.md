---
title: "N18: Code coverage gate (JaCoCo/V8/coverage.py/go cover/cargo-tarpaulin)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N18 hash=9c063d57a156e354b822cdd7bc2e1fcd926ff1f5d0029ed2cefecc728a2b9e05 generator=kit@1 -->
# N18: Code coverage gate (JaCoCo/V8/coverage.py/go cover/cargo-tarpaulin)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | test_framework |

## Notes

Coverage threshold enforced at L2; arbiter default 85% lines, kit baseline 80%

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: jacoco (via coverage) |
| `typescript` | tool: vitest/c8 (via coverage) |
| `python` | tool: pytest-cov (via coverage) |
| `go` | tool: go test -cover (via coverage) |
| `rust` | tool: cargo-tarpaulin (via coverage) |

