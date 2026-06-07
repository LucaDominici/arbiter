---
generated: true
source: 'docs/REFERENCE/coverage/dim-73-tamper-evident-audit-log-table-ddl-security-critical-operations.md'
source_sha: 'd877f91057b3797a7349f9096e40b515bda60968'
last_updated: '2026-06-07'
---

# N73: Tamper-evident audit log table DDL (security-critical operations)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-73-tamper-evident-audit-log-table-ddl-security-critical-operations.md](../docs/REFERENCE/coverage/dim-73-tamper-evident-audit-log-table-ddl-security-critical-operations.md)

<!-- arbiter-generated dim=N73 hash=984a99ebce92ce73442a48a13eef001c0f6e6f274783c0af3fd93a1fd1941657 generator=kit@1 -->

# N73: Tamper-evident audit log table DDL (security-critical operations)

| Field     | Value                    |
| --------- | ------------------------ |
| TML       | L3                       |
| Gate      | BLOCKING                 |
| Status    | missing-tracked          |
| Category  | audit_trail              |
| Flag      | `--audit-write-services` |
| Follow-up | #862                     |

## Notes

Tamper-evident audit log for security-critical operations; DDL with insert-only grants and created_at immutability

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
