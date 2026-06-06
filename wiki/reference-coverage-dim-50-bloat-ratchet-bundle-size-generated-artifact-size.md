---
generated: true
source: 'docs/REFERENCE/coverage/dim-50-bloat-ratchet-bundle-size-generated-artifact-size.md'
source_sha: 'c3eff59af29f91c174cbc0f8cb78dc1b9bd75600'
last_updated: '2026-06-06'
---

# N50: Bloat ratchet (bundle size / generated artifact size)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-50-bloat-ratchet-bundle-size-generated-artifact-size.md](../docs/REFERENCE/coverage/dim-50-bloat-ratchet-bundle-size-generated-artifact-size.md)

<!-- arbiter-generated dim=N50 hash=c107872660390ced29e8f06958a91b196733b5a86e732ae9c42982a1c79077bf generator=kit@1 -->

# N50: Bloat ratchet (bundle size / generated artifact size)

| Field    | Value              |
| -------- | ------------------ |
| TML      | L2                 |
| Gate     | ADVISORY           |
| Status   | covered            |
| Category | scripts_validation |

## Notes

check-bloat-ratchet.mjs enforces size baseline at L1; refuses shrink without --allow-shrink

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
