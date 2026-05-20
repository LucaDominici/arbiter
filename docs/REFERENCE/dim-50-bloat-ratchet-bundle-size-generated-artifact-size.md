---
title: "N50: Bloat ratchet (bundle size / generated artifact size)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N50 hash=c107872660390ced29e8f06958a91b196733b5a86e732ae9c42982a1c79077bf generator=kit@1 -->
# N50: Bloat ratchet (bundle size / generated artifact size)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | covered |
| Category | scripts_validation |

## Notes

check-bloat-ratchet.mjs enforces size baseline at L1; refuses shrink without --allow-shrink

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | gap |
| `typescript` | gap |
| `python` | gap |
| `go` | gap |
| `rust` | gap |

