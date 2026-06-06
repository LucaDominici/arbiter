---
generated: true
source: 'docs/REFERENCE/coverage/dim-30-architectural-tests-archunit-structure-rules.md'
source_sha: '990a1fbb16e661b008fef6aea96e7e8f3143cf1b'
last_updated: '2026-06-06'
---

# N30: Architectural tests (ArchUnit / structure rules)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-30-architectural-tests-archunit-structure-rules.md](../docs/REFERENCE/coverage/dim-30-architectural-tests-archunit-structure-rules.md)

<!-- arbiter-generated dim=N30 hash=20d5afb7469436a7395d5d7fea8002978b001cb838650ab20550968801234429 generator=kit@1 -->

# N30: Architectural tests (ArchUnit / structure rules)

| Field    | Value      |
| -------- | ---------- |
| TML      | L2         |
| Gate     | BLOCKING   |
| Status   | partial    |
| Category | test_types |

## Notes

Architecture rule tests wired for hexagonal archetype; other archetypes use static analysis

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: pact-jvm (via contract)              |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python`     | tool: pact-python (via contract)           |
| `go`         | tool: pact_consumer (Go) (via contract)    |
| `rust`       | tool: pact_consumer (via contract)         |
