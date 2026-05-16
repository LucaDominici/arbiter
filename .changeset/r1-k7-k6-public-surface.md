---
'arbiter': minor
---

feat(w1-bundle): r1.k7+k6 — config $schemaVersion + plugin API stability gate (#605 #603)

- `arbiter.json` gains an optional `$schemaVersion: <int>` field. Migration writes `$schemaVersion: 2` on every v2 output; load rejects `$schemaVersion > CURRENT_CONFIG_SCHEMA_VERSION` as a hard error so a future config never silently loads.
- New `docs/PLUGIN-API.md` enumerates `ArbiterPlugin` / `PluginContext` / `PluginFile` / `PluginResult` field-by-field with stability markers (stable / beta / experimental) plus the apiVersion bump policy.
- New L1 gate `scripts/check-plugin-api-stability.mjs` fails any PR that edits `src/types/plugin.ts` without bumping `apiVersion` in the same commit.
