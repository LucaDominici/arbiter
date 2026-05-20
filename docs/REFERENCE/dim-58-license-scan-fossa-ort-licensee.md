---
title: "N58: License scan (FOSSA / ORT / licensee)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N58 hash=a8c6d158b79832c020efbe3063b7dd04221fb14af81183ad3cc93c7b991146db generator=kit@1 -->
# N58: License scan (FOSSA / ORT / licensee)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | security |

## Notes

License scan at T5 weekly tier; blocks on GPL/AGPL in permissively-licensed services

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security) |
| `python` | tool: pip-audit (via security) |
| `go` | tool: govulncheck (via security) |
| `rust` | tool: cargo audit (via security) |

