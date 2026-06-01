---
title: "N11: PMD / Semgrep rules (complexity, security anti-patterns)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N11 hash=9909f6cdf53b13232ea0e4784d4f104b10cc9da5ac7b3b876adbce90bb8efc0e generator=kit@1 -->
# N11: PMD / Semgrep rules (complexity, security anti-patterns)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

PMD Java-specific; Semgrep applicable cross-stack but not yet enforced

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

