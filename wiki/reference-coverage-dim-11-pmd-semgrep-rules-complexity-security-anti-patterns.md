---
generated: true
source: 'docs/REFERENCE/coverage/dim-11-pmd-semgrep-rules-complexity-security-anti-patterns.md'
source_sha: 'cc35096426b1a0ec6fc008e46bfd8162d013102d'
last_updated: '2026-06-07'
---

# N11: PMD / Semgrep rules (complexity, security anti-patterns)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-11-pmd-semgrep-rules-complexity-security-anti-patterns.md](../docs/REFERENCE/coverage/dim-11-pmd-semgrep-rules-complexity-security-anti-patterns.md)

<!-- arbiter-generated dim=N11 hash=9909f6cdf53b13232ea0e4784d4f104b10cc9da5ac7b3b876adbce90bb8efc0e generator=kit@1 -->

# N11: PMD / Semgrep rules (complexity, security anti-patterns)

| Field    | Value           |
| -------- | --------------- |
| TML      | L2              |
| Gate     | ADVISORY        |
| Status   | partial         |
| Category | static_analysis |

## Notes

PMD Java-specific; Semgrep applicable cross-stack but not yet enforced

## Per-Stack Coverage

| Stack        | Kind                                                         |
| ------------ | ------------------------------------------------------------ |
| `java`       | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis)                  |
| `python`     | tool: ruff (via static_analysis)                             |
| `go`         | tool: golangci-lint (via static_analysis)                    |
| `rust`       | tool: clippy (via static_analysis)                           |
