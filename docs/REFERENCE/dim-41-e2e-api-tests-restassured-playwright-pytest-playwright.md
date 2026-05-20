---
title: "N41: E2E API tests (RestAssured / Playwright / pytest-playwright)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N41 hash=0b9aa2d3488855ebb4a76237ed244f8d968d0a7c171b3ee68651c9630994ab4a generator=kit@1 -->
# N41: E2E API tests (RestAssured / Playwright / pytest-playwright)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | covered |
| Category | e2e_perf |

## Notes

E2E tests wired at L3 nightly tier; Playwright for browser stacks, RestAssured for Java APIs

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: RestAssured IT (via e2e) |
| `typescript` | tool: Playwright (via e2e) |
| `python` | tool: Playwright / pytest-playwright (via e2e) |
| `go` | tool: owasp-zap (via dast) |
| `rust` | tool: owasp-zap (via dast) |

