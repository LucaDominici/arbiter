---
'@arbiter/cli': minor
---

`ship --batch` (deprecated at warn stage since 0.4.0, ADR-103 #1873, scheduled
removeIn 0.6.0) is removed: the `--batch` flag, `runShipBatchCommand`, and the
whole `src/batch/` module (`runBatch`, `runShipBatch`, `parseIssueList`, and
related types) are deleted. Use `/drain` (wave-drain skill) for overnight
multi-issue runs. `docs/DEPRECATIONS.md` moves the row to Closed/Removed;
`CLI_DEPRECATED_FLAGS` is now empty.
