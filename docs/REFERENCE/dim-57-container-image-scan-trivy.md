<!-- arbiter-generated dim=N57 hash=56624f2820de34197984bce0121babe764ab3c1dcf2a5001b1bf7003a3fe313b generator=kit@1 -->
# N57: Container image scan (Trivy)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | partial |
| Category | security |

## Notes

Trivy container scan at T5 weekly tier; generated for services with Dockerfile

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security) |
| `python` | tool: pip-audit (via security) |
| `go` | tool: govulncheck (via security) |
| `rust` | tool: cargo audit (via security) |

