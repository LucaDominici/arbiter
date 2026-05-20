---
title: "N28: Contract tests (Spring Cloud Contract / Pact)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N28 hash=74a2d0f26ad4e407b9f5f62689ebeada3e1006b2878d1e795d1db0cb9a029403 generator=kit@1 -->
# N28: Contract tests (Spring Cloud Contract / Pact)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | ADVISORY |
| Status | partial |
| Category | test_types |

## Notes

Contract testing enforced at L2 for service APIs; coverage varies by stack

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: pact-jvm (via contract) |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python` | tool: pact-python (via contract) |
| `go` | tool: pact_consumer (Go) (via contract) |
| `rust` | tool: pact_consumer (via contract) |

