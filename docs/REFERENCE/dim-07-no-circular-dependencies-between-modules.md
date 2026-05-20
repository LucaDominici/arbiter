---
title: "N07: No circular dependencies between modules"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N07 hash=e6f0d4c3c65c4df5fe57527da42a4064e0d37f1f9869082c305bc277451aa9d0 generator=kit@1 -->
# N07: No circular dependencies between modules

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | architecture |
| Invariant | `INV-03` |

## Notes

Enforced by madge (TS) / ArchUnit (Java) / cargo check (Rust)

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: ArchUnit (via architecture) |
| `typescript` | tool: eslint-plugin-boundaries (via architecture) |
| `python` | tool: import-linter + ruff (via architecture) |
| `go` | tool: golangci-lint (depguard) (via architecture) |
| `rust` | tool: cargo-deny + clippy (via architecture) |

