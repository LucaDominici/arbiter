---
generated: true
source: 'docs/REFERENCE/coverage/dim-51-debt-ratchet-tech-debt-score-gate.md'
source_sha: '26bea5752e9500bdf4826f5558afeb2e994567ab'
last_updated: '2026-06-06'
---

# N51: Debt ratchet (tech-debt score gate)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-51-debt-ratchet-tech-debt-score-gate.md](../docs/REFERENCE/coverage/dim-51-debt-ratchet-tech-debt-score-gate.md)

<!-- arbiter-generated dim=N51 hash=06d02c95e56f21fea26aa8fc76b91754fed1493c1561bd21a535b7abf7f168f0 generator=kit@1 -->

# N51: Debt ratchet (tech-debt score gate)

| Field    | Value           |
| -------- | --------------- |
| TML      | L1              |
| Gate     | ADVISORY        |
| Status   | covered         |
| Category | scripts_quality |

## Notes

debt-report.mjs --gate enforced at L2; debt score cannot increase without explicit override

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
