---
generated: true
source: 'docs/REFERENCE/coverage/dim-35-pr-fast-feedback-gate-5-min-l1-checks-only.md'
source_sha: 'e6e45f6404fceca405924f9516e8ec85845b7f94'
last_updated: '2026-06-08'
---

# N35: PR fast-feedback gate (&lt;5 min, L1 checks only)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-35-pr-fast-feedback-gate-5-min-l1-checks-only.md](../docs/REFERENCE/coverage/dim-35-pr-fast-feedback-gate-5-min-l1-checks-only.md)

<!-- arbiter-generated dim=N35 hash=57b28136d6660638b27d56b55408211739f20701682e751d9601f3b448475445 generator=kit@1 -->

# N35: PR fast-feedback gate (&lt;5 min, L1 checks only)

| Field     | Value    |
| --------- | -------- |
| TML       | L2       |
| Gate      | BLOCKING |
| Status    | covered  |
| Category  | cicd     |
| Invariant | `INV-73` |

## Notes

T1 (check subcommand) completes in ~2 min; T2 (gate) in ~10 min

## Per-Stack Coverage

| Stack        | Kind                             |
| ------------ | -------------------------------- |
| `java`       | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python`     | tool: gitleaks (via secret_scan) |
| `go`         | tool: gitleaks (via secret_scan) |
| `rust`       | tool: gitleaks (via secret_scan) |
