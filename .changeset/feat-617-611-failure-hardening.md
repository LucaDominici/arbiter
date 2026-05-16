---
'arbiter': minor
---

feat(#617 #611): adverse git state detection + atomic file writes

- Detects rebase, merge, cherry-pick, bisect, and detached HEAD before writing files
- `--force` flag overrides the check with a warning
- All file writes now use atomic tmp-then-rename pattern; ENOSPC surfaces a clear UserFacingError
