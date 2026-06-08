---
generated: true
source: 'docs/REFERENCE/coverage/dim-36-release-pipeline-tag-triggered-artifact-signing.md'
source_sha: 'aaf49494621a36115a9c1fbd238ae487b0f85c8c'
last_updated: '2026-06-08'
---

# N36: Release pipeline (tag-triggered, artifact signing)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-36-release-pipeline-tag-triggered-artifact-signing.md](../docs/REFERENCE/coverage/dim-36-release-pipeline-tag-triggered-artifact-signing.md)

<!-- arbiter-generated dim=N36 hash=fda7a8f8692c90b288a4a05ce5d47a133d215a804d286b15fbafa3f11defddab generator=kit@1 -->

# N36: Release pipeline (tag-triggered, artifact signing)

| Field     | Value    |
| --------- | -------- |
| TML       | L3       |
| Gate      | BLOCKING |
| Status    | covered  |
| Category  | cicd     |
| Invariant | `INV-79` |

## Notes

Release workflow signs artifacts with cosign; SLSA provenance via attest-build-provenance

## Per-Stack Coverage

| Stack        | Kind                             |
| ------------ | -------------------------------- |
| `java`       | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python`     | tool: gitleaks (via secret_scan) |
| `go`         | tool: gitleaks (via secret_scan) |
| `rust`       | tool: gitleaks (via secret_scan) |
