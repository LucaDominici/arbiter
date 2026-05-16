---
'arbiter': minor
---

feat(w1-bundle): r1.k9+l9 — state file schema version + checksum + repair (#607 #619)

- `.arbiter-generated.json` is now a versioned envelope `{ ".checksum", "$schemaVersion": 1, "config": {...} }` with a SHA-256 of the canonical inner payload.
- `loadSnapshot` throws `SnapshotChecksumError` on tamper instead of silently overwriting.
- v0 (pre-envelope) snapshots auto-migrate on first read — no user action required.
- `saveConfigAndSnapshot` rotates the previous snapshot to `.arbiter-generated.json.bak.<iso-ts>`, capped at the 10 most recent backups.
- New `arbiter doctor --repair-state` re-derives the snapshot from `arbiter.json` (never touches the source config).
- Storage migrations live under `src/state/migrations/`, paralleling `src/config/migrations/`.
