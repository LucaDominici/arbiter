---
title: 'Active Deprecations'
doc_version: '1.2.0'
status: active
last_review: '2026-09-02'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Active Deprecations

Symbols, flags, and behaviors that are deprecated and scheduled for removal.

Policy: 2-MAJOR-release deprecation window (see `docs/SEMVER.md`).  
CI gate: `scripts/check-deprecations.mjs` fails if a deprecated symbol is removed before its `remove-in` version,
**and** (#2449) fails if a symbol carries a JSDoc `@deprecated` tag in `src/` with no row in the table below —
so a deprecation can never exist without a version and a removal window.  
Override: `ALLOW_REMOVE_DEPRECATED=1 node scripts/check-all.mjs` (document the emergency in this table).

## Format

| Symbol / Flag / Behavior | Deprecated in | Remove in | Replacement                                                | Status    | Stage |
| ------------------------ | ------------- | --------- | ---------------------------------------------------------- | --------- | ----- |
| soloDevMode              | 0.2.0         | 1.0.0     | `collaborationMode: 'trunk-solo'`                          | in-window | —     |
| enableSoloDevMode        | 0.2.0         | 1.0.0     | `collaborationMode: 'trunk-solo'`                          | in-window | —     |
| ciTierMode               | 0.2.0         | 1.0.0     | `pipelineStyle`                                            | in-window | —     |
| `--no-adopt-gate-spine`  | 0.5.0         | 0.8.0     | (none — omit the flag; withholding is already the default) | in-window | warn  |
| `--no-adopt-governance`  | 0.5.0         | 0.8.0     | (none — omit the flag; withholding is already the default) | in-window | warn  |

**Why `remove-in = 1.0.0`:** all three are `arbiter.json` / wizard-answer config fields, and
`docs/SEMVER.md` classifies removing a config schema field as MAJOR. Pre-1.0 the next MAJOR is
`1.0.0`, which is also the removal point INV-100 already names for `soloDevMode`. All three are
still live back-compat aliases read by `src/config/resolve-project-config.ts`,
`src/config/collaboration-mode-defaults.ts`, `src/generators/github.ts`, `src/wizard/prompts.ts`
and the generated `check-ci-tiers.mjs`, so they are genuinely deprecated-but-live, not dead tags.

**Why `--no-adopt-gate-spine` / `--no-adopt-governance` are deprecated, not fixed (#2453):**
#2119 and #2141 flipped `update`'s default from adopt to withhold for the gate spine
(`scripts/check-all.mjs`, `scripts/lib/*.mjs`) and governance files (`AGENTS.md`,
`.claude/settings.json`). Both flags were kept as accepted no-ops purely so a consumer's
pre-#2119/#2141 script (written when adoption was the default and these flags opted OUT of it)
would not break on an unknown-option error the day the default flipped underneath it. There is
no live behavior left for either flag to opt into: withholding is now unconditional, so there is
nothing a negation can meaningfully negate. That made a bare `--no-adopt-gate-spine` /
`--no-adopt-governance` a **silent** no-op — accepted, doing nothing, with no signal to a
consumer who believed the flag mattered. Registered here at `warn` stage (#2453) so passing
either now prints a real stderr deprecation notice via `src/internal/cli-deprecation-registry.ts`
(wired at `src/cli.ts`); `remove-in = 0.8.0` gives ≥1 MINOR of runway before the flag is
rejected outright. The **positive** opt-ins, `--adopt-gate-spine` / `--adopt-governance`, are
unaffected — they still work exactly as #2119/#2141 shipped them.

## Closed / Removed Deprecations

| Symbol / Flag / Behavior | Was deprecated in | Removed in | Replacement                          |
| ------------------------ | ----------------- | ---------- | ------------------------------------ |
| ship --batch             | 0.4.0             | 0.6.0      | `/drain` (wave-drain skill), ADR-103 |

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

Steps 1 and 3 are mutually enforced: the gate fails on a table row whose symbol is gone from
`src/`, and (#2449) on an `@deprecated` tag in `src/` whose symbol has no row here. Adding one
without the other is a gate failure, not a silent gap.

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
