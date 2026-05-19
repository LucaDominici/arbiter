<!-- arbiter-generated dim=N74 hash=8e52f417c6415e6a7e35d4a2e1a7372d30659e574df10e89ec044a5c3a561684 generator=kit@1 -->
# N74: Audit trigger presence (DB-level audit trigger enforced)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | missing-tracked |
| Category | audit_trail |
| Flag | `--audit-write-services` |
| Follow-up | #862 |

## Notes

Database trigger enforces audit log population for security-critical write operations

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | gap |
| `typescript` | gap |
| `python` | gap |
| `go` | gap |
| `rust` | gap |

