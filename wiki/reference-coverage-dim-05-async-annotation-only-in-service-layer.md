---
generated: true
source: 'docs/REFERENCE/coverage/dim-05-async-annotation-only-in-service-layer.md'
source_sha: '04e958a93c4c67e13734cada6cca012459db2e0e'
last_updated: '2026-06-08'
---

# N05: @Async annotation only in service layer

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-05-async-annotation-only-in-service-layer.md](../docs/REFERENCE/coverage/dim-05-async-annotation-only-in-service-layer.md)

<!-- arbiter-generated dim=N05 hash=3557b79f94930d7bb4beffedebbb7978cb3aa52b7e28cb8a5bfd2afe6f2727e5 generator=kit@1 -->

# N05: @Async annotation only in service layer

| Field    | Value        |
| -------- | ------------ |
| TML      | L2           |
| Gate     | BLOCKING     |
| Status   | missing      |
| Category | architecture |

## Notes

Java/Spring-specific: async methods must be in application/service layer, not domain

## Per-Stack Coverage

| Stack        | Kind                              |
| ------------ | --------------------------------- |
| `java`       | tool: ArchUnit (via architecture) |
| `typescript` | N/A by paradigm                   |
| `python`     | N/A by paradigm                   |
| `go`         | N/A by paradigm                   |
| `rust`       | N/A by paradigm                   |
