---
generated: true
source: 'docs/REFERENCE/coverage/dim-10-static-analysis-formatting-spotlessprettierblackgofmtrustfmt.md'
source_sha: '3235d342aa2bfeef2d5e4fe25dbce6666c91ee34'
last_updated: '2026-06-07'
---

# N10: Static analysis: formatting (spotless/prettier/black/gofmt/rustfmt)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-10-static-analysis-formatting-spotlessprettierblackgofmtrustfmt.md](../docs/REFERENCE/coverage/dim-10-static-analysis-formatting-spotlessprettierblackgofmtrustfmt.md)

<!-- arbiter-generated dim=N10 hash=eabe28acbe667e9ec3ceb74699177a278c5f6d29704f76a784201d1df839398f generator=kit@1 -->

# N10: Static analysis: formatting (spotless/prettier/black/gofmt/rustfmt)

| Field    | Value           |
| -------- | --------------- |
| TML      | L1              |
| Gate     | BLOCKING        |
| Status   | covered         |
| Category | static_analysis |

## Notes

Format check enforced at L1 gate

## Per-Stack Coverage

| Stack        | Kind                                                         |
| ------------ | ------------------------------------------------------------ |
| `java`       | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | tool: eslint+prettier (via static_analysis)                  |
| `python`     | tool: ruff (via static_analysis)                             |
| `go`         | tool: golangci-lint (via static_analysis)                    |
| `rust`       | tool: clippy (via static_analysis)                           |
