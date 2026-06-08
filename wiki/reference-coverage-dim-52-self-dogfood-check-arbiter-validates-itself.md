---
generated: true
source: 'docs/REFERENCE/coverage/dim-52-self-dogfood-check-arbiter-validates-itself.md'
source_sha: 'fc942f1759dd81d51f24f785b68230443294b842'
last_updated: '2026-06-08'
---

# N52: Self-dogfood check (arbiter validates itself)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-52-self-dogfood-check-arbiter-validates-itself.md](../docs/REFERENCE/coverage/dim-52-self-dogfood-check-arbiter-validates-itself.md)

<!-- arbiter-generated dim=N52 hash=c5e2d1544fa3b78a462e26f6e72fbe0cc97d2c25af48d955fcc0720bbdc999c5 generator=kit@1 -->

# N52: Self-dogfood check (arbiter validates itself)

| Field     | Value           |
| --------- | --------------- |
| TML       | L1              |
| Gate      | BLOCKING        |
| Status    | covered         |
| Category  | scripts_quality |
| Invariant | `INV-75`        |

## Notes

INV-75/76: downstream check-action-pins + check-workflow-perms gates run at L1 in target repos; arbiter self-dogfood retired during CI freeze (#862)

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
