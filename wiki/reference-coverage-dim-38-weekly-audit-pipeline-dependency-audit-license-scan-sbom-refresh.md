---
generated: true
source: 'docs/REFERENCE/coverage/dim-38-weekly-audit-pipeline-dependency-audit-license-scan-sbom-refresh.md'
source_sha: '3f6dbca0111e002ca7e7778d7d7fde2e167fb926'
last_updated: '2026-06-07'
---

# N38: Weekly audit pipeline (dependency audit, license scan, SBOM refresh)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-38-weekly-audit-pipeline-dependency-audit-license-scan-sbom-refresh.md](../docs/REFERENCE/coverage/dim-38-weekly-audit-pipeline-dependency-audit-license-scan-sbom-refresh.md)

<!-- arbiter-generated dim=N38 hash=b42cd10a30d2ee83732a2d73dd1037e98e41c8fdfcd501a20a5ab259f1379c45 generator=kit@1 -->

# N38: Weekly audit pipeline (dependency audit, license scan, SBOM refresh)

| Field    | Value    |
| -------- | -------- |
| TML      | L3       |
| Gate     | ADVISORY |
| Status   | covered  |
| Category | cicd     |

## Notes

T5 weekly tier runs npm audit, license scan, SBOM refresh, gitleaks full scan

## Per-Stack Coverage

| Stack        | Kind                             |
| ------------ | -------------------------------- |
| `java`       | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python`     | tool: gitleaks (via secret_scan) |
| `go`         | tool: gitleaks (via secret_scan) |
| `rust`       | tool: gitleaks (via secret_scan) |
