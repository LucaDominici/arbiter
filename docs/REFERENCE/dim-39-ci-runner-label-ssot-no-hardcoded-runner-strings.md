<!-- arbiter-generated dim=N39 hash=cb83591d4a36622101241b96b57ce03f6edbccaa30bfe5b91eb966edf8b27550 generator=kit@1 -->
# N39: CI runner label SSOT (no hardcoded runner strings)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | cicd |
| Invariant | `INV-13` |

## Notes

INV-13 enforces CI_BUILD_RUNNER_LABEL repo variable as SSOT; downstream-generated check-workflow-runners gates this in target repos

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

