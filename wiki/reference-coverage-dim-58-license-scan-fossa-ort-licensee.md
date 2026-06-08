---
generated: true
source: 'docs/REFERENCE/coverage/dim-58-license-scan-fossa-ort-licensee.md'
source_sha: '92359fbbec1bb437ae9103fe2d23a0784bae3c71'
last_updated: '2026-06-08'
---

# N58: License scan (FOSSA / ORT / licensee)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-58-license-scan-fossa-ort-licensee.md](../docs/REFERENCE/coverage/dim-58-license-scan-fossa-ort-licensee.md)

<!-- arbiter-generated dim=N58 hash=a8c6d158b79832c020efbe3063b7dd04221fb14af81183ad3cc93c7b991146db generator=kit@1 -->

# N58: License scan (FOSSA / ORT / licensee)

| Field    | Value    |
| -------- | -------- |
| TML      | L3       |
| Gate     | ADVISORY |
| Status   | partial  |
| Category | security |

## Notes

License scan at T5 weekly tier; blocks on GPL/AGPL in permissively-licensed services

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security)             |
| `python`     | tool: pip-audit (via security)             |
| `go`         | tool: govulncheck (via security)           |
| `rust`       | tool: cargo audit (via security)           |
