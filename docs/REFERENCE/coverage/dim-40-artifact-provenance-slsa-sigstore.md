---
title: "N40: Artifact provenance (SLSA / sigstore)"
doc_version: "1.0.0"
status: active
last_review: "2026-06-01"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N40 hash=38820696e9b8cbf8bff930e89b86ce74118479b59147578c24d96fea172805fb generator=kit@1 -->
# N40: Artifact provenance (SLSA / sigstore)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | covered |
| Category | cicd |
| Invariant | `INV-78` |

## Notes

SLSA provenance generated via actions/attest-build-provenance for all release artifacts

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

