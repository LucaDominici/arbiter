---
generated: true
source: 'docs/REFERENCE/coverage/dim-31-fuzz-testing-jazzer-go-fuzz-cargo-fuzz.md'
source_sha: '47f811cec4a19cb714581a79945b282b9c8e5909'
last_updated: '2026-06-07'
---

# N31: Fuzz testing (Jazzer / go-fuzz / cargo-fuzz)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-31-fuzz-testing-jazzer-go-fuzz-cargo-fuzz.md](../docs/REFERENCE/coverage/dim-31-fuzz-testing-jazzer-go-fuzz-cargo-fuzz.md)

<!-- arbiter-generated dim=N31 hash=bb3e0e370bbff3bdc8d7f56083a8ae07b9c091ab423cc1935f0f7fb1d29eb907 generator=kit@1 -->

# N31: Fuzz testing (Jazzer / go-fuzz / cargo-fuzz)

| Field    | Value      |
| -------- | ---------- |
| TML      | L3         |
| Gate     | ADVISORY   |
| Status   | partial    |
| Category | test_types |

## Notes

Fuzz testing supported at L3 nightly tier; tooling coverage varies by stack

## Per-Stack Coverage

| Stack        | Kind                                       |
| ------------ | ------------------------------------------ |
| `java`       | tool: pact-jvm (via contract)              |
| `typescript` | tool: @pact-foundation/pact (via contract) |
| `python`     | tool: pact-python (via contract)           |
| `go`         | tool: pact_consumer (Go) (via contract)    |
| `rust`       | tool: pact_consumer (via contract)         |
