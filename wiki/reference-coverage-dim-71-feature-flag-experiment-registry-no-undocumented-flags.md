---
generated: true
source: 'docs/REFERENCE/coverage/dim-71-feature-flag-experiment-registry-no-undocumented-flags.md'
source_sha: '1ff22321541ea0d3b5eb9510ae3065687c32b6a1'
last_updated: '2026-06-06'
---

# N71: Feature flag / experiment registry (no undocumented flags)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-71-feature-flag-experiment-registry-no-undocumented-flags.md](../docs/REFERENCE/coverage/dim-71-feature-flag-experiment-registry-no-undocumented-flags.md)

<!-- arbiter-generated dim=N71 hash=6bad9ee00fdf821b5417b31b6a7b3598a5d3fe05bce1dde8f4cf9ec4e4295047 generator=kit@1 -->

# N71: Feature flag / experiment registry (no undocumented flags)

| Field    | Value         |
| -------- | ------------- |
| TML      | L2            |
| Gate     | ADVISORY      |
| Status   | covered       |
| Category | configuration |

## Notes

src/experimental/registry.ts enforces known-experiment guard; unknown flag = exit 1

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
