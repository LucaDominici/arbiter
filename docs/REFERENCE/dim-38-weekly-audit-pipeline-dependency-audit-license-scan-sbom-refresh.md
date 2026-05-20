---
title: "N38: Weekly audit pipeline (dependency audit, license scan, SBOM refresh)"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/dev', 'kind/reference']
related: []
---

<!-- arbiter-generated dim=N38 hash=b42cd10a30d2ee83732a2d73dd1037e98e41c8fdfcd501a20a5ab259f1379c45 generator=kit@1 -->
# N38: Weekly audit pipeline (dependency audit, license scan, SBOM refresh)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | ADVISORY |
| Status | covered |
| Category | cicd |

## Notes

T5 weekly tier runs npm audit, license scan, SBOM refresh, gitleaks full scan

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

