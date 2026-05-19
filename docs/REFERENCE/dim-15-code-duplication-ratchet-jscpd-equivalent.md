<!-- arbiter-generated dim=N15 hash=f5b464466c0c80446eb036f04eb721565588ac1d1a87101eeb77eac617e1e814 generator=kit@1 -->
# N15: Code duplication ratchet (jscpd / equivalent)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

jscpd wired for TS at L2 gate; Java uses PMD CPD; other stacks partial

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

