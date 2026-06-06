---
generated: true
source: 'docs/REFERENCE/coverage/dim-08-tamper-evident-audit-log-insert-only-rule-r-audit-insert-only.md'
source_sha: 'c591f3b8e778a4d86a251af2011cf3b9c53b0ed0'
last_updated: '2026-06-06'
---

# N08: Tamper-evident audit log insert-only rule (R-audit-insert-only)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-08-tamper-evident-audit-log-insert-only-rule-r-audit-insert-only.md](../docs/REFERENCE/coverage/dim-08-tamper-evident-audit-log-insert-only-rule-r-audit-insert-only.md)

<!-- arbiter-generated dim=N08 hash=ac51f90b780c18381d5875643e9419b725e08f89eea74a72dcfe894805eac40e generator=kit@1 -->

# N08: Tamper-evident audit log insert-only rule (R-audit-insert-only)

| Field     | Value                    |
| --------- | ------------------------ |
| TML       | L2                       |
| Gate      | BLOCKING                 |
| Status    | missing-tracked          |
| Category  | audit_trail              |
| Flag      | `--audit-write-services` |
| Follow-up | #862                     |

## Notes

Tamper-evident audit log: append-only pattern enforced by architecture rule R-audit-insert-only

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
