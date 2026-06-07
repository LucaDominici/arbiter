---
generated: true
source: 'docs/REFERENCE/coverage/dim-70-environment-variable-safety-envexample-only-no-real-env-committed.md'
source_sha: '7c6ce942d177672ff56f86acee7f320dc83bd01d'
last_updated: '2026-06-07'
---

# N70: Environment variable safety (.env.example only, no real .env committed)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-70-environment-variable-safety-envexample-only-no-real-env-committed.md](../docs/REFERENCE/coverage/dim-70-environment-variable-safety-envexample-only-no-real-env-committed.md)

<!-- arbiter-generated dim=N70 hash=117dec6ebfa1b4fec932dda409ddd610f0ce430d26e69190073a1f3eef67e650 generator=kit@1 -->

# N70: Environment variable safety (.env.example only, no real .env committed)

| Field     | Value         |
| --------- | ------------- |
| TML       | L1            |
| Gate      | BLOCKING      |
| Status    | covered       |
| Category  | configuration |
| Invariant | `INV-24`      |

## Notes

Gitleaks catches .env commits; arbiter generates only .env.\*.example templates

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
