---
generated: true
source: 'docs/REFERENCE/coverage/dim-14-dead-code-detection.md'
source_sha: 'd54cc69253e577d34002bd35e3fbbeaec44369a0'
last_updated: '2026-06-07'
---

# N14: Dead code detection

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-14-dead-code-detection.md](../docs/REFERENCE/coverage/dim-14-dead-code-detection.md)

<!-- arbiter-generated dim=N14 hash=d3021daf0111b9fba0518bd9942f03f102895193c30c0298862b727848964bb7 generator=kit@1 -->

# N14: Dead code detection

| Field    | Value           |
| -------- | --------------- |
| TML      | L2              |
| Gate     | ADVISORY        |
| Status   | partial         |
| Category | static_analysis |

## Notes

knip (TS), golangci-lint deadcode (Go), cargo unused (Rust); Java via PMD

## Per-Stack Coverage

| Stack        | Kind                                                         |
| ------------ | ------------------------------------------------------------ |
| `java`       | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis)                  |
| `python`     | tool: ruff (via static_analysis)                             |
| `go`         | tool: golangci-lint (via static_analysis)                    |
| `rust`       | tool: clippy (via static_analysis)                           |
