---
generated: true
source: 'docs/REFERENCE/coverage/dim-12-spotbugs-null-safety-analysis.md'
source_sha: 'b8cb5352acad663b042c5e583b580dd02d467d35'
last_updated: '2026-06-06'
---

# N12: SpotBugs / null-safety analysis

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/coverage/dim-12-spotbugs-null-safety-analysis.md](../docs/REFERENCE/coverage/dim-12-spotbugs-null-safety-analysis.md)

<!-- arbiter-generated dim=N12 hash=60ac4f2e5b4d98bd3f71a9d18fa8ef8863ecfea4e14b6807eee49986fa68ab27 generator=kit@1 -->

# N12: SpotBugs / null-safety analysis

| Field    | Value           |
| -------- | --------------- |
| TML      | L2              |
| Gate     | ADVISORY        |
| Status   | partial         |
| Category | static_analysis |

## Notes

SpotBugs Java-specific; TypeScript has strict null checks; Rust/Go enforce at compiler level

## Per-Stack Coverage

| Stack        | Kind                                                         |
| ------------ | ------------------------------------------------------------ |
| `java`       | tool: checkstyle+pmd+spotbugs+spotless (via static_analysis) |
| `typescript` | equivalent: static_analysis                                  |
| `python`     | equivalent: static_analysis                                  |
| `go`         | N/A by paradigm                                              |
| `rust`       | N/A by paradigm                                              |
