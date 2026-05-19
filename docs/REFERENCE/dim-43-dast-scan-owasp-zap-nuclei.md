<!-- arbiter-generated dim=N43 hash=ed9265063f983c7bdeb9f8f8199c46415d3b829dfafa903f0ad3ffc63f80e2b5 generator=kit@1 -->
# N43: DAST scan (OWASP ZAP / Nuclei)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | e2e_perf |

## Notes

DAST wired at T4 nightly tier; ZAP scan against running service

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: RestAssured IT (via e2e) |
| `typescript` | tool: Playwright (via e2e) |
| `python` | tool: Playwright / pytest-playwright (via e2e) |
| `go` | tool: owasp-zap (via dast) |
| `rust` | tool: owasp-zap (via dast) |

