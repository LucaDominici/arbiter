---
title: "N04: No Spring annotations in domain layer"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N04 hash=c8a23fb44110aa27c6e46114630838e0846688b5d413469cb560b2aba6037769 generator=kit@1 -->
# N04: No Spring annotations in domain layer

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | missing |
| Category | architecture |

## Notes

Java/Spring-specific: domain classes must not use @Component, @Service, @Repository etc.

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: ArchUnit (via architecture) |
| `typescript` | N/A by paradigm |
| `python` | N/A by paradigm |
| `go` | N/A by paradigm |
| `rust` | N/A by paradigm |

