---
title: "N73: Tamper-evident audit log table DDL (security-critical operations)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N73 hash=984a99ebce92ce73442a48a13eef001c0f6e6f274783c0af3fd93a1fd1941657 generator=kit@1 -->
# N73: Tamper-evident audit log table DDL (security-critical operations)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | missing-tracked |
| Category | audit_trail |
| Flag | `--audit-write-services` |
| Follow-up | #862 |

## Notes

Tamper-evident audit log for security-critical operations; DDL with insert-only grants and created_at immutability

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | gap |
| `typescript` | gap |
| `python` | gap |
| `go` | gap |
| `rust` | gap |

