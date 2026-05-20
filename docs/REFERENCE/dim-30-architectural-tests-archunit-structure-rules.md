---
title: "N30: Architectural tests (ArchUnit / structure rules)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: []
related: []
---

<!-- arbiter-generated dim=N30 hash=20d5afb7469436a7395d5d7fea8002978b001cb838650ab20550968801234429 generator=kit@1 -->
# N30: Architectural tests (ArchUnit / structure rules)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | partial |
| Category | test_types |

## Notes

Architecture rule tests wired for hexagonal archetype; other archetypes use static analysis

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: pact-jvm (via contract) |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python` | tool: pact-python (via contract) |
| `go` | tool: pact_consumer (Go) (via contract) |
| `rust` | tool: pact_consumer (via contract) |

