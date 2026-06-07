---
generated: true
source: 'docs/REFERENCE/coverage/dim-55-secret-scanning-gitleaks.md'
source_sha: '3755bb652dd020e8f4278e01d47e1cbb35765368'
last_updated: '2026-06-07'
---

# N55: Secret scanning (Gitleaks)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-55-secret-scanning-gitleaks.md](../docs/REFERENCE/coverage/dim-55-secret-scanning-gitleaks.md)

<!-- arbiter-generated dim=N55 hash=a89a95293f8bd6e02201cb746191d0aea1f1a9713494e8c7aa0c244df692725e generator=kit@1 -->

# N55: Secret scanning (Gitleaks)

| Field     | Value    |
| --------- | -------- |
| TML       | L1       |
| Gate      | BLOCKING |
| Status    | covered  |
| Category  | security |
| Invariant | `INV-24` |

## Notes

Gitleaks on staged files (pre-commit hook) + full repo scan at L2 gate

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security)             |
| `python`     | tool: pip-audit (via security)             |
| `go`         | tool: govulncheck (via security)           |
| `rust`       | tool: cargo audit (via security)           |
