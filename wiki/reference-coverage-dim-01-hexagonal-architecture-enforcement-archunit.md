---
generated: true
source: 'docs/REFERENCE/coverage/dim-01-hexagonal-architecture-enforcement-archunit.md'
source_sha: '1598101c6230d382f51a6ec09850297538ac7f4f'
last_updated: '2026-06-06'
---

# N01: Hexagonal architecture enforcement (ArchUnit)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-01-hexagonal-architecture-enforcement-archunit.md](../docs/REFERENCE/coverage/dim-01-hexagonal-architecture-enforcement-archunit.md)

<!-- arbiter-generated dim=N01 hash=fd8798d922e9f58daf861e1c5f785897873d2cedcdb9c25b1d1494c381851e1b generator=kit@1 -->

# N01: Hexagonal architecture enforcement (ArchUnit)

| Field     | Value        |
| --------- | ------------ |
| TML       | L2           |
| Gate      | BLOCKING     |
| Status    | partial      |
| Category  | architecture |
| Invariant | `INV-22`     |

## Notes

ArchUnit rules enforced at L2 for Java hexagonal archetype; cross-stack architecture rules vary by paradigm

## Per-Stack Coverage

| Stack        | Kind                                              |
| ------------ | ------------------------------------------------- |
| `java`       | tool: ArchUnit (via architecture)                 |
| `typescript` | tool: eslint-plugin-boundaries (via architecture) |
| `python`     | tool: import-linter + ruff (via architecture)     |
| `go`         | tool: golangci-lint (depguard) (via architecture) |
| `rust`       | tool: cargo-deny + clippy (via architecture)      |
