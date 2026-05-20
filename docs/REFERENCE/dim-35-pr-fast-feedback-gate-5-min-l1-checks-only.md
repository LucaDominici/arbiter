---
title: "N35: PR fast-feedback gate (&lt;5 min, L1 checks only)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N35 hash=57b28136d6660638b27d56b55408211739f20701682e751d9601f3b448475445 generator=kit@1 -->
# N35: PR fast-feedback gate (&lt;5 min, L1 checks only)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | cicd |
| Invariant | `INV-73` |

## Notes

T1 (check subcommand) completes in ~2 min; T2 (gate) in ~10 min

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

