---
title: "N75: Audit log service interface (AuditEventService / append-only repository pattern)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N75 hash=3257579b3bc18656da56989c42c46f12b12224af6d21ccff27d948e2b6510a61 generator=kit@1 -->
# N75: Audit log service interface (AuditEventService / append-only repository pattern)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | missing-tracked |
| Category | audit_trail |
| Flag | `--audit-write-services` |
| Follow-up | #862 |

## Notes

Append-only repository pattern for audit events; no update/delete operations permitted in service layer

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | gap |
| `typescript` | gap |
| `python` | gap |
| `go` | gap |
| `rust` | gap |

