---
title: "N06: Bean Validation constraints in domain entities only"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N06 hash=ed5c30cf04638847bfea98e81617a4aee554c0cf3bf1e2e346f859840db634b6 generator=kit@1 -->
# N06: Bean Validation constraints in domain entities only

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | missing |
| Category | architecture |

## Notes

Java/Spring: validation annotations (@NotNull, @Size etc.) confined to domain entities

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: ArchUnit (via architecture) |
| `typescript` | equivalent: static_analysis |
| `python` | equivalent: static_analysis |
| `go` | N/A by paradigm |
| `rust` | N/A by paradigm |

