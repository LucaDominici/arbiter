---
title: "N12: SpotBugs / null-safety analysis"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N12 hash=60ac4f2e5b4d98bd3f71a9d18fa8ef8863ecfea4e14b6807eee49986fa68ab27 generator=kit@1 -->
# N12: SpotBugs / null-safety analysis

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

SpotBugs Java-specific; TypeScript has strict null checks; Rust/Go enforce at compiler level

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | equivalent: static_analysis |
| `python` | equivalent: static_analysis |
| `go` | N/A by paradigm |
| `rust` | N/A by paradigm |

