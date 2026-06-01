---
title: "N31: Fuzz testing (Jazzer / go-fuzz / cargo-fuzz)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N31 hash=bb3e0e370bbff3bdc8d7f56083a8ae07b9c091ab423cc1935f0f7fb1d29eb907 generator=kit@1 -->
# N31: Fuzz testing (Jazzer / go-fuzz / cargo-fuzz)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | partial |
| Category | test_types |

## Notes

Fuzz testing supported at L3 nightly tier; tooling coverage varies by stack

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: pact-jvm (via contract) |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python` | tool: pact-python (via contract) |
| `go` | tool: pact_consumer (Go) (via contract) |
| `rust` | tool: pact_consumer (via contract) |

