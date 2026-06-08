---
generated: true
source: 'docs/REFERENCE/coverage/dim-06-bean-validation-constraints-in-domain-entities-only.md'
source_sha: '4cf7afe295f88fcb4d381523da2db3ab09043fb7'
last_updated: '2026-06-08'
---

# N06: Bean Validation constraints in domain entities only

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-06-bean-validation-constraints-in-domain-entities-only.md](../docs/REFERENCE/coverage/dim-06-bean-validation-constraints-in-domain-entities-only.md)

<!-- arbiter-generated dim=N06 hash=ed5c30cf04638847bfea98e81617a4aee554c0cf3bf1e2e346f859840db634b6 generator=kit@1 -->

# N06: Bean Validation constraints in domain entities only

| Field    | Value        |
| -------- | ------------ |
| TML      | L2           |
| Gate     | BLOCKING     |
| Status   | missing      |
| Category | architecture |

## Notes

Java/Spring: validation annotations (@NotNull, @Size etc.) confined to domain entities

## Per-Stack Coverage

| Stack        | Kind                              |
| ------------ | --------------------------------- |
| `java`       | tool: ArchUnit (via architecture) |
| `typescript` | equivalent: static_analysis       |
| `python`     | equivalent: static_analysis       |
| `go`         | N/A by paradigm                   |
| `rust`       | N/A by paradigm                   |
