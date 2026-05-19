<!-- arbiter-generated dim=N36 hash=fda7a8f8692c90b288a4a05ce5d47a133d215a804d286b15fbafa3f11defddab generator=kit@1 -->
# N36: Release pipeline (tag-triggered, artifact signing)

| Field | Value |
|---|---|
| TML | L3 |
| Gate | BLOCKING |
| Status | covered |
| Category | cicd |
| Invariant | `INV-79` |

## Notes

Release workflow signs artifacts with cosign; SLSA provenance via attest-build-provenance

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

