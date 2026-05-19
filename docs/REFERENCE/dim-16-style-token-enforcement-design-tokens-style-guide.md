<!-- arbiter-generated dim=N16 hash=9dc2e160c64bc2612d8f19f7169e99e5bf297fa753c8126ef7590ce4d18e63c4 generator=kit@1 -->
# N16: Style token enforcement (design tokens / style guide)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | static_analysis |

## Notes

CSS/styling tokens enforced for frontend stacks; backend services use code style only

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis) |
| `python` | tool: ruff (via static_analysis) |
| `go` | tool: golangci-lint (via static_analysis) |
| `rust` | tool: clippy (via static_analysis) |

