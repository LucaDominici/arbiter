---
generated: true
source: 'docs/REFERENCE/coverage/dim-75-audit-log-service-interface-auditeventservice-append-only-repository-pattern.md'
source_sha: '48c213f63d80f5e48b4c454858b411236d40b0ac'
last_updated: '2026-06-07'
---

# N75: Audit log service interface (AuditEventService / append-only repository pattern)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-75-audit-log-service-interface-auditeventservice-append-only-repository-pattern.md](../docs/REFERENCE/coverage/dim-75-audit-log-service-interface-auditeventservice-append-only-repository-pattern.md)

<!-- arbiter-generated dim=N75 hash=3257579b3bc18656da56989c42c46f12b12224af6d21ccff27d948e2b6510a61 generator=kit@1 -->

# N75: Audit log service interface (AuditEventService / append-only repository pattern)

| Field     | Value                    |
| --------- | ------------------------ |
| TML       | L3                       |
| Gate      | BLOCKING                 |
| Status    | missing-tracked          |
| Category  | audit_trail              |
| Flag      | `--audit-write-services` |
| Follow-up | #862                     |

## Notes

Append-only repository pattern for audit events; no update/delete operations permitted in service layer

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
