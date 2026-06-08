---
generated: true
source: 'docs/REFERENCE/coverage/dim-40-artifact-provenance-slsa-sigstore.md'
source_sha: '64716f0b61f6a7cb546b4473d9afed419e23bf89'
last_updated: '2026-06-08'
---

# N40: Artifact provenance (SLSA / sigstore)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-40-artifact-provenance-slsa-sigstore.md](../docs/REFERENCE/coverage/dim-40-artifact-provenance-slsa-sigstore.md)

<!-- arbiter-generated dim=N40 hash=38820696e9b8cbf8bff930e89b86ce74118479b59147578c24d96fea172805fb generator=kit@1 -->

# N40: Artifact provenance (SLSA / sigstore)

| Field     | Value    |
| --------- | -------- |
| TML       | L3       |
| Gate      | BLOCKING |
| Status    | covered  |
| Category  | cicd     |
| Invariant | `INV-78` |

## Notes

SLSA provenance generated via actions/attest-build-provenance for all release artifacts

## Per-Stack Coverage

| Stack        | Kind                             |
| ------------ | -------------------------------- |
| `java`       | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python`     | tool: gitleaks (via secret_scan) |
| `go`         | tool: gitleaks (via secret_scan) |
| `rust`       | tool: gitleaks (via secret_scan) |
