---
generated: true
source: 'docs/REFERENCE/coverage/dim-43-dast-scan-owasp-zap-nuclei.md'
source_sha: 'ca395b134d86d56f0e246074c42525b48f6f5b6e'
last_updated: '2026-06-06'
---

# N43: DAST scan (OWASP ZAP / Nuclei)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-43-dast-scan-owasp-zap-nuclei.md](../docs/REFERENCE/coverage/dim-43-dast-scan-owasp-zap-nuclei.md)

<!-- arbiter-generated dim=N43 hash=ed9265063f983c7bdeb9f8f8199c46415d3b829dfafa903f0ad3ffc63f80e2b5 generator=kit@1 -->

# N43: DAST scan (OWASP ZAP / Nuclei)

| Field    | Value    |
| -------- | -------- |
| TML      | L3       |
| Gate     | ADVISORY |
| Status   | partial  |
| Category | e2e_perf |

## Notes

DAST wired at T4 nightly tier; ZAP scan against running service

## Per-Stack Coverage

| Stack        | Kind                                           |
| ------------ | ---------------------------------------------- |
| `java`       | tool: RestAssured IT (via e2e)                 |
| `typescript` | tool: Playwright (via e2e)                     |
| `python`     | tool: Playwright / pytest-playwright (via e2e) |
| `go`         | tool: owasp-zap (via dast)                     |
| `rust`       | tool: owasp-zap (via dast)                     |
