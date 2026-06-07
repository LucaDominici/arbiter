---
generated: true
source: 'docs/REFERENCE/coverage/dim-57-container-image-scan-trivy.md'
source_sha: 'ce9d47b94075e706c7a9cf2410ac9566824c1a70'
last_updated: '2026-06-07'
---

# N57: Container image scan (Trivy)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-57-container-image-scan-trivy.md](../docs/REFERENCE/coverage/dim-57-container-image-scan-trivy.md)

<!-- arbiter-generated dim=N57 hash=56624f2820de34197984bce0121babe764ab3c1dcf2a5001b1bf7003a3fe313b generator=kit@1 -->

# N57: Container image scan (Trivy)

| Field    | Value    |
| -------- | -------- |
| TML      | L3       |
| Gate     | BLOCKING |
| Status   | partial  |
| Category | security |

## Notes

Trivy container scan at T5 weekly tier; generated for services with Dockerfile

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security)             |
| `python`     | tool: pip-audit (via security)             |
| `go`         | tool: govulncheck (via security)           |
| `rust`       | tool: cargo audit (via security)           |
