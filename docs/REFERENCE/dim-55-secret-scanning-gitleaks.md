<!-- arbiter-generated dim=N55 hash=a89a95293f8bd6e02201cb746191d0aea1f1a9713494e8c7aa0c244df692725e generator=kit@1 -->
# N55: Secret scanning (Gitleaks)

| Field | Value |
|---|---|
| TML | L1 |
| Gate | BLOCKING |
| Status | covered |
| Category | security |
| Invariant | `INV-24` |

## Notes

Gitleaks on staged files (pre-commit hook) + full repo scan at L2 gate

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security) |
| `python` | tool: pip-audit (via security) |
| `go` | tool: govulncheck (via security) |
| `rust` | tool: cargo audit (via security) |

