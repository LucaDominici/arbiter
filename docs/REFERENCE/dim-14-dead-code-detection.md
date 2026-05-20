---
title: "N14: Dead code detection"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N14 hash=d3021daf0111b9fba0518bd9942f03f102895193c30c0298862b727848964bb7 generator=kit@1 -->
# N14: Dead code detection

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

knip (TS), golangci-lint deadcode (Go), cargo unused (Rust); Java via PMD

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

