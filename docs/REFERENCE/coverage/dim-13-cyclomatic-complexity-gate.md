---
title: "N13: Cyclomatic complexity gate"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N13 hash=aef5b385368ed0122f3974f00a0f43fcb40ba580cbb541cd84c8cce25e5b54d4 generator=kit@1 -->
# N13: Cyclomatic complexity gate

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

Complexity rules in golangci-lint/ruff/eslint; Java via PMD; threshold enforcement varies by stack

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

