---
title: "N03: Interface + implementation separation rule"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N03 hash=47f9f7e2dd649b74bfa056f1613474037ef56c2713f23b6b5031ea92985cd429 generator=kit@1 -->
# N03: Interface + implementation separation rule

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | missing |
| Category | architecture |

## Notes

Port/adapter pattern: repository interfaces in domain, implementations in infrastructure

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: ArchUnit (via architecture) |
| `typescript` | equivalent: static_analysis |
| `python` | equivalent: static_analysis |
| `go` | equivalent: architecture |
| `rust` | equivalent: architecture |

