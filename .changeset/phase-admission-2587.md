---
'@getarbiter/cli': patch
---

Validate enabled acceptance anchors before entering the RED phase, and require
valid, committed branch-produced TDD receipts for the primary and chained tasks
before verification. Keep whole-chain validation out of GREEN so chained work can
progress. Document that a skipped worktree pre-commit hook does not prove L1 passed.
