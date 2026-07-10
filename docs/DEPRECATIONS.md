---
title: 'Active Deprecations'
doc_version: '1.1.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Active Deprecations

Symbols, flags, and behaviors that are deprecated and scheduled for removal.

Policy: 2-MAJOR-release deprecation window (see `docs/SEMVER.md`).  
CI gate: `scripts/check-deprecations.mjs` fails if a deprecated symbol is removed before its `remove-in` version.  
Override: `ALLOW_REMOVE_DEPRECATED=1 node scripts/check-all.mjs` (document the emergency in this table).

## Format

| Symbol / Flag / Behavior | Deprecated in | Remove in | Replacement                          | Status     | Stage |
| ------------------------ | ------------- | --------- | ------------------------------------ | ---------- | ----- |
| ship --batch             | 0.4.0         | 0.6.0     | `/drain` (wave-drain skill), ADR-103 | deprecated | warn  |

## Closed / Removed Deprecations

| Symbol / Flag / Behavior | Was deprecated in | Removed in | Replacement |
| ------------------------ | ----------------- | ---------- | ----------- |
| _(none yet)_             | —                 | —          | —           |

---

## CLI Flag Lifecycle

CLI flags follow a three-stage deprecation lifecycle managed by `src/internal/cli-deprecation-registry.ts`.

| Stage    | Behavior                                                                  |
| -------- | ------------------------------------------------------------------------- |
| `warn`   | Flag still accepted. stderr deprecation notice emitted on each use.       |
| `hide`   | Flag accepted but silently stripped from `--help`. stderr notice emitted. |
| `remove` | Flag rejected with non-zero exit. Error message points to replacement.    |

**Stage transition policy:** each stage transition requires ≥ 1 MINOR version gap.
The gate (`scripts/check-deprecations.mjs`) enforces that `deprecatedIn ≠ removeIn`.

---

## How to Deprecate Something

1. Add a row to the Active table above with `remove-in = current_major + 2`.
2. At the callsite, call `warnDeprecated(name, removeIn)` from `src/internal/deprecate.ts`.
3. Add `@deprecated` JSDoc to the exported symbol.
4. Commit the change — `check-deprecations.mjs` will enforce the window going forward.

## How to Deprecate a CLI Flag

1. Add an entry to `CLI_DEPRECATED_FLAGS` in `src/internal/cli-deprecation-registry.ts`:
   ```ts
   { flag: '--old-flag', stage: 'warn', deprecatedIn: '0.2.0', removeIn: '0.4.0', replacement: '--new-flag' }
   ```
2. `stage` starts at `'warn'`; advance through `'hide'` → `'remove'` across MINOR releases.
3. Add a row to the Active table above (with Stage column).

## How to Remove a Deprecated Symbol

1. Verify `current_version >= remove-in` from this table.
2. Move the row to the Closed table.
3. Delete the symbol from source.
4. The gate will pass because the symbol is no longer in the Active table.
