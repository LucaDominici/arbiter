<!-- arbiter-generated dim=N19 hash=5997212966b55afaee9d7008fd428de4305c554a1850b2da53ae282ec1f5634f generator=kit@1 -->
# N19: Coverage trend ratchet (no regression allowed)

| Field | Value |
|---|---|
| TML | L2 |
| Gate | BLOCKING |
| Status | covered |
| Category | test_framework |

## Notes

Coverage baseline ratchet prevents regressions across PRs

## Per-Stack Coverage

| Stack | Kind |
|---|---|
| `java` | tool: jacoco (via coverage) |
| `typescript` | tool: vitest/c8 (via coverage) |
| `python` | tool: pytest-cov (via coverage) |
| `go` | tool: go test -cover (via coverage) |
| `rust` | tool: cargo-tarpaulin (via coverage) |

