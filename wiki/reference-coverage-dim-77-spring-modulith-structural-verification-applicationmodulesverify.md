---
generated: true
source: 'docs/REFERENCE/coverage/dim-77-spring-modulith-structural-verification-applicationmodulesverify.md'
source_sha: 'dd48d072f4077a921dc6e886e944b18ff7c0b773'
last_updated: '2026-06-08'
---

# N77: Spring Modulith structural verification (ApplicationModules.verify())

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-77-spring-modulith-structural-verification-applicationmodulesverify.md](../docs/REFERENCE/coverage/dim-77-spring-modulith-structural-verification-applicationmodulesverify.md)

<!-- arbiter-generated dim=N77 hash=2aa8a0265d199b1aaf9647006c1b6f8ea8479393c1e1ab2c6de4d8aa545b12c2 generator=kit@1 -->

# N77: Spring Modulith structural verification (ApplicationModules.verify())

| Field    | Value             |
| -------- | ----------------- |
| TML      | L2                |
| Gate     | BLOCKING          |
| Status   | covered           |
| Category | module_boundaries |
| Flag     | `--spring-boot`   |

## Notes

Spring Modulith verifies no cyclic module dependencies and no forbidden cross-module access. Requires spring-modulith-test on the classpath.

## Per-Stack Coverage

| Stack        | Kind |
| ------------ | ---- |
| `java`       | gap  |
| `typescript` | gap  |
| `python`     | gap  |
| `go`         | gap  |
| `rust`       | gap  |
