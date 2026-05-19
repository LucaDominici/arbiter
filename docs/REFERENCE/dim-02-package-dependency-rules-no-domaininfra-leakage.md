<!-- arbiter-generated dim=N02 hash=8d80e5970bc1e934f710edc6fa8fa8b5af157a1a9632426dbafe406fd7d45975 generator=kit@1 -->
# N02: Package dependency rules (no domain→infra leakage)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | partial |
| Category | architecture |
| Invariant | `INV-22` |

## Notes

Hexagonal layering: domain must not import infrastructure packages

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: ArchUnit (via architecture) |
| `typescript` | tool: eslint-plugin-boundaries (via architecture) |
| `python` | tool: import-linter + ruff (via architecture) |
| `go` | tool: golangci-lint (depguard) (via architecture) |
| `rust` | tool: cargo-deny + clippy (via architecture) |

