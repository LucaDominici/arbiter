---
'arbiter': minor
---

F4+F11: `--github` opt-in default and project board namespacing.

- `--github` flag is now required for live GitHub API calls (`arbiter init`, `arbiter update`). Without it, no API calls are made regardless of stored config.
- `ARBITER_GITHUB=1` env var activates GitHub API calls in CI.
- Stored config key `useGitHub` renamed to `permitGitHub`; old key auto-migrated on first run.
- Project board titles now include project name: `<name> Board · <owner>/<repo> · <date>`.
- Idempotent board detection updated to match namespaced titles.
