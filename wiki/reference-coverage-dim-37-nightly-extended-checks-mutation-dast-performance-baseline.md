---
generated: true
source: 'docs/REFERENCE/coverage/dim-37-nightly-extended-checks-mutation-dast-performance-baseline.md'
source_sha: '0ee0ccce6d72d212c57f81d910ad845b60b117d7'
last_updated: '2026-06-07'
---

# N37: Nightly extended checks (mutation, DAST, performance baseline)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-37-nightly-extended-checks-mutation-dast-performance-baseline.md](../docs/REFERENCE/coverage/dim-37-nightly-extended-checks-mutation-dast-performance-baseline.md)

<!-- arbiter-generated dim=N37 hash=c930cb357e7e2e168a17f86a9ff71748672cd791a218c2aac5b993873092f00f generator=kit@1 -->

# N37: Nightly extended checks (mutation, DAST, performance baseline)

| Field     | Value    |
| --------- | -------- |
| TML       | L3       |
| Gate      | ADVISORY |
| Status    | covered  |
| Category  | cicd     |
| Invariant | `INV-76` |

## Notes

T4 nightly tier runs mutation + DAST + fuzz; heartbeat monitor keeps pipeline honest

## Per-Stack Coverage

| Stack        | Kind                             |
| ------------ | -------------------------------- |
| `java`       | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python`     | tool: gitleaks (via secret_scan) |
| `go`         | tool: gitleaks (via secret_scan) |
| `rust`       | tool: gitleaks (via secret_scan) |
