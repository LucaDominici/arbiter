---
generated: true
source: 'docs/REFERENCE/coverage/dim-13-cyclomatic-complexity-gate.md'
source_sha: '9254bd01a4825daba6b85953ecc82a36b5edaa1a'
last_updated: '2026-06-06'
---

# N13: Cyclomatic complexity gate

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-13-cyclomatic-complexity-gate.md](../docs/REFERENCE/coverage/dim-13-cyclomatic-complexity-gate.md)

<!-- arbiter-generated dim=N13 hash=aef5b385368ed0122f3974f00a0f43fcb40ba580cbb541cd84c8cce25e5b54d4 generator=kit@1 -->

# N13: Cyclomatic complexity gate

| Field    | Value           |
| -------- | --------------- |
| TML      | L2              |
| Gate     | ADVISORY        |
| Status   | partial         |
| Category | static_analysis |

## Notes

Complexity rules in golangci-lint/ruff/eslint; Java via PMD; threshold enforcement varies by stack

## Per-Stack Coverage

| Stack        | Kind                                                         |
| ------------ | ------------------------------------------------------------ |
| `java`       | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis)                  |
| `python`     | tool: ruff (via static_analysis)                             |
| `go`         | tool: golangci-lint (via static_analysis)                    |
| `rust`       | tool: clippy (via static_analysis)                           |
