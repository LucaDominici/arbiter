<!-- arbiter-generated dim=N34 hash=c018ad03634db66f3f1bc519ab204e7bfa6c7f2f5e2813eb52f1ce02e518bcd7 generator=kit@1 -->
# N34: Multi-tier CI pipeline (fast → extended → release → nightly → weekly)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | cicd |
| Invariant | `INV-73` |

## Notes

6-tier CI model (T0..T5) enforced by workflow runner checks and ci-alignment gate

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: gitleaks (via secret_scan) |
| `typescript` | tool: gitleaks (via secret_scan) |
| `python` | tool: gitleaks (via secret_scan) |
| `go` | tool: gitleaks (via secret_scan) |
| `rust` | tool: gitleaks (via secret_scan) |

