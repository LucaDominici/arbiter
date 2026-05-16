---
'@arbiter/cli': minor
---

Add experimental feature flag system (#601). Introduces `--experimental.<name>` CLI flag for opt-in experimental features. Unknown experiment names are rejected with a clear error. Flags stored in `ARBITER_EXPERIMENTAL` env var for downstream commands. Registry ships empty; experiments added as features are promoted to beta.
