---
generated: true
source: 'docs/REFERENCE/coverage/dim-54-circular-dependency-detection.md'
source_sha: 'b976b60d0cf6f5b82c02f0b6dc0e0971253c0533'
last_updated: '2026-06-07'
---

# N54: Circular dependency detection

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-54-circular-dependency-detection.md](../docs/REFERENCE/coverage/dim-54-circular-dependency-detection.md)

<!-- arbiter-generated dim=N54 hash=47eb336fe28a260163ef2d2196e7c5e8a5d7a900fd90af4e73af45ab33c140e5 generator=kit@1 -->

# N54: Circular dependency detection

| Field     | Value           |
| --------- | --------------- |
| TML       | L1              |
| Gate      | BLOCKING        |
| Status    | covered         |
| Category  | scripts_quality |
| Invariant | `INV-03`        |

## Notes

madge --circular at L1 gate; post-edit hook checks after every TS/JS edit

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
