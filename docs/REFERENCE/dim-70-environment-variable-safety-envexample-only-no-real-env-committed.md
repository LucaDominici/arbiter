---
title: "N70: Environment variable safety (.env.example only, no real .env committed)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N70 hash=117dec6ebfa1b4fec932dda409ddd610f0ce430d26e69190073a1f3eef67e650 generator=kit@1 -->
# N70: Environment variable safety (.env.example only, no real .env committed)

| Field | Value |
|---|---|
| TML | L1 |
| Gate | BLOCKING |
| Status | covered |
| Category | configuration |
| Invariant | `INV-24` |

## Notes

Gitleaks catches .env commits; arbiter generates only .env.*.example templates

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | gap |
| `typescript` | gap |
| `python` | gap |
| `go` | gap |
| `rust` | gap |

