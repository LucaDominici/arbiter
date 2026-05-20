---
title: "N56: Dependency audit (npm audit / OWASP dependency-check / cargo audit)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N56 hash=98e01035d9563c1ac1e7ed275e2df8343fd32d2f487befdc03c383050415e6a5 generator=kit@1 -->
# N56: Dependency audit (npm audit / OWASP dependency-check / cargo audit)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | security |

## Notes

npm audit at L2 gate; cargo audit / pip-audit supported; blocks on HIGH+ severity

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: OWASP DependencyCheck (via security) |
| `typescript` | tool: npm audit (via security) |
| `python` | tool: pip-audit (via security) |
| `go` | tool: govulncheck (via security) |
| `rust` | tool: cargo audit (via security) |

