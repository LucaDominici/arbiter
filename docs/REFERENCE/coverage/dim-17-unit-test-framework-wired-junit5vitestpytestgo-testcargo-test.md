---
title: "N17: Unit test framework wired (JUnit5/Vitest/pytest/go test/cargo test)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N17 hash=47841681e05f25d6fde6e40525c1b56aff16852eb30fb8815243c81d43f6812f generator=kit@1 -->
# N17: Unit test framework wired (JUnit5/Vitest/pytest/go test/cargo test)

| Field | Value |
|---|---|
| TML | L1 |
| Gate | BLOCKING |
| Status | covered |
| Category | test_framework |

## Notes

Each stack has a canonical unit test runner wired into L1 gate

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: jacoco (via coverage) |
| `typescript` | tool: vitest/c8 (via coverage) |
| `python` | tool: pytest-cov (via coverage) |
| `go` | tool: go test -cover (via coverage) |
| `rust` | tool: cargo-tarpaulin (via coverage) |

