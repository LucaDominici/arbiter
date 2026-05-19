<!-- arbiter-generated dim=N09 hash=0b26b570a70d142064cf3edce4e3577949660c2eab6fafe688f49acb4e90cf4a generator=kit@1 -->
# N09: Static analysis: linting (checkstyle/eslint/ruff/golangci-lint/clippy)

| Field | Value |
|---|---|
| TML | L1 |
| Gate | BLOCKING |
| Status | covered |
| Category | static_analysis |
| Invariant | `INV-01` |

## Notes

L1 gate enforces per-stack linter with zero-warning policy

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

