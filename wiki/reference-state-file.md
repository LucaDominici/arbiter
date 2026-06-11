---
generated: true
source: 'docs/REFERENCE/state-file.md'
source_sha: '8d73e9900e894836b31e88fbee0de2dcc4cbb82e'
last_updated: '2026-06-11'
---

# `.arbiter-generated.json` State File

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/state-file.md](../docs/REFERENCE/state-file.md)

# `.arbiter-generated.json` State File

**Issues:** #607 (schema version + migrations), #619 (checksum + repair)

The snapshot file records the config used to generate the project. `arbiter update` reads it to detect drift and regenerate selectively. Schema changes here break existing users — hence versioning, checksum, and a repair path.

---

## Storage layout

```json
{
  ".checksum": "<sha256-hex>",
  "$schemaVersion": 1,
  "config": {
    "version": "0.2",
    "tools": ["claude", "codex"],
    "...": "rest of ArbiterConfigV2"
  }
}
```

| Field            | Type   | Notes                                                                          |
| ---------------- | ------ | ------------------------------------------------------------------------------ |
| `.checksum`      | hex    | SHA-256 of `canonicalJson({$schemaVersion, config})` — must come first on read |
| `$schemaVersion` | int    | Storage-envelope version (currently `1`)                                       |
| `config`         | object | The full `ArbiterConfig` exactly as it appears in `arbiter.json`               |

The checksum is computed against the **canonical** serialisation (object keys sorted recursively) so reordering equivalent JSON does not invalidate it.

---

## Read path (`loadSnapshot`)

1. Missing file → return `null` (legitimate; first run).
2. Unparseable JSON → warn + return `null`.
3. **v0 (pre-envelope) snapshot** — bare config blob → auto-wrap and return (no error, no warning). Caller may re-persist on next write to attach a checksum.
4. **v1 envelope** — verify checksum:
   - Mismatch → **throw `SnapshotChecksumError`** (no silent recovery).
   - Match → unwrap, run through config migrations, return.

---

## Write path (`saveConfigAndSnapshot`)

1. Write `arbiter.json` (raw config, no envelope).
2. Rotate the previous snapshot to `.arbiter-generated.json.bak.<iso-ts>`.
3. Prune oldest `.bak.*` files past cap (default **10**).
4. Wrap current config in envelope, compute checksum, write `.arbiter-generated.json`.

`writeSnapshot(dir, config)` does steps 2-4 only; used by `arbiter doctor --repair-state` to avoid touching `arbiter.json`.

---

## Migrations

Storage migrations live under `src/state/migrations/` and parallel the config migrations under `src/config/migrations/`. Add new versions by:

1. Bump `CURRENT_SNAPSHOT_VERSION` in `src/state/envelope.ts`.
2. Add `src/state/migrations/vN-to-vN+1.ts` exporting `migrateVNToVN+1(rawEnvelope)`.
3. Extend the router in `src/state/migrations/index.ts`.
4. Add fixtures + tests under `__tests__/unit/state/migrations/`.

Migrations run before the config migration chain, so a v0 snapshot containing a pre-v2 config goes through both: `migrateState` (envelope) then `migrate` (config).

---

## Repair

When `loadSnapshot` throws `SnapshotChecksumError` (or the file is otherwise unrecoverable):

```bash
arbiter doctor --repair-state
```

This re-derives the snapshot from `arbiter.json` (the source-of-truth config), writes a fresh envelope, and prints the new snapshot path. `arbiter.json` is never modified.

Pre-existing backup files at `.arbiter-generated.json.bak.<ts>` remain available for forensic comparison; the repair rotates yet another backup before writing.

---

## Exit codes

| Command                         | Exit | Meaning                                                                  |
| ------------------------------- | ---- | ------------------------------------------------------------------------ |
| `arbiter doctor --repair-state` | 0    | Snapshot re-derived; new envelope written                                |
| `arbiter doctor --repair-state` | 2    | `arbiter.json` missing or unparseable — repair impossible without source |
