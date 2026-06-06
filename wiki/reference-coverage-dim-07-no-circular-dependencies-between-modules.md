---
generated: true
source: 'docs/REFERENCE/coverage/dim-07-no-circular-dependencies-between-modules.md'
source_sha: '5406c125147b4c95c85ff5a466addeb90d88d56d'
last_updated: '2026-06-06'
---

# N07: No circular dependencies between modules

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-07-no-circular-dependencies-between-modules.md](../docs/REFERENCE/coverage/dim-07-no-circular-dependencies-between-modules.md)

<!-- arbiter-generated dim=N07 hash=e6f0d4c3c65c4df5fe57527da42a4064e0d37f1f9869082c305bc277451aa9d0 generator=kit@1 -->

# N07: No circular dependencies between modules

| Field     | Value        |
| --------- | ------------ |
| TML       | L2           |
| Gate      | BLOCKING     |
| Status    | covered      |
| Category  | architecture |
| Invariant | `INV-03`     |

## Notes

Enforced by madge (TS) / ArchUnit (Java) / cargo check (Rust)

## Per-Stack Coverage

| Stack        | Kind                                              |
| ------------ | ------------------------------------------------- |
| `java`       | tool: ArchUnit (via architecture)                 |
| `typescript` | tool: eslint-plugin-boundaries (via architecture) |
| `python`     | tool: import-linter + ruff (via architecture)     |
| `go`         | tool: golangci-lint (depguard) (via architecture) |
| `rust`       | tool: cargo-deny + clippy (via architecture)      |
