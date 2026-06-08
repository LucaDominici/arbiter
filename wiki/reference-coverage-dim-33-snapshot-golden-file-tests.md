---
generated: true
source: 'docs/REFERENCE/coverage/dim-33-snapshot-golden-file-tests.md'
source_sha: 'a18ed7bf735460b9c229783bfec1c6016effb1ed'
last_updated: '2026-06-08'
---

# N33: Snapshot / golden-file tests

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-33-snapshot-golden-file-tests.md](../docs/REFERENCE/coverage/dim-33-snapshot-golden-file-tests.md)

<!-- arbiter-generated dim=N33 hash=4e2ce79e18df7e43adb7cb4e64fb1625035ed81f9eac3443d05348076a231c05 generator=kit@1 -->

# N33: Snapshot / golden-file tests

| Field    | Value      |
| -------- | ---------- |
| TML      | L2         |
| Gate     | ADVISORY   |
| Status   | partial    |
| Category | test_types |

## Notes

Snapshot tests used in arbiter self-tests (api-snapshot.mjs); pattern available cross-stack

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: pact-jvm (via contract)              |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python`     | tool: pact-python (via contract)           |
| `go`         | tool: pact_consumer (Go) (via contract)    |
| `rust`       | tool: pact_consumer (via contract)         |
