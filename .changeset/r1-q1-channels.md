---
'arbiter': minor
---

feat(#660): npm dist-tag channel strategy — latest / beta / canary (R1.Q1)

- `docs/CHANNELS.md` documents three channels (stable / beta / canary), install commands, tag shapes, and rollback procedure.
- `.github/workflows/npm-publish.yml` resolves the npm dist-tag from the tag shape.
- New `.github/workflows/canary-publish.yml` publishes `v0.0.0-canary.<short-sha>` on every push to `main`.
