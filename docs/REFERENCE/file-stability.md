---
title: 'Generated File Format Stability Map'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Generated File Format Stability Map

**Issue:** #609

Every file arbiter generates has a declared stability status. This determines the semver contract callers can rely on.

---

## Stability Levels

| Status           | Semver guarantee                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| **stable**       | Format is backward-compatible across MINOR. Breaking changes require MAJOR.                                  |
| **evolving**     | Format may change in MINOR releases. Migration support is provided but may require running `arbiter update`. |
| **experimental** | No stability guarantee. May change or be removed without a semver bump.                                      |

---

## File Map

### AGENTS.md

| Property       | Value                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default path   | `AGENTS.md` (project root)                                                                                                                                               |
| Status         | **stable**                                                                                                                                                               |
| User-editable  | Yes — the custom-content zone between the generation markers is preserved on update.                                                                                     |
| Merge strategy | arbiter preserves lines between `<!-- arbiter:custom:start -->` and `<!-- arbiter:custom:end -->` markers on every `arbiter update`. Generated sections are regenerated. |

### .claude/settings.json

| Property       | Value                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| Default path   | `.claude/settings.json`                                                    |
| Status         | **stable**                                                                 |
| User-editable  | Additive — users may add entries outside arbiter-managed keys.             |
| Merge strategy | arbiter merges its managed keys. User-added keys survive `arbiter update`. |

### GLOBAL_INVARIANTS.md

| Property       | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Default path   | `GLOBAL_INVARIANTS.md`                                                    |
| Status         | **stable**                                                                |
| User-editable  | No — fully managed by arbiter. Custom documentation belongs in AGENTS.md. |
| Merge strategy | Fully regenerated on `arbiter update`.                                    |

### .arbiter-generated.json

| Property       | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| Default path   | `.arbiter-generated.json`                                                     |
| Status         | **evolving**                                                                  |
| User-editable  | No — machine-written state file.                                              |
| Merge strategy | Migrated automatically by `arbiter update` via the schema migration registry. |

### arbiter.json

| Property       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Default path   | `arbiter.json`                                                                               |
| Status         | **stable**                                                                                   |
| User-editable  | Yes — this is the primary user configuration file.                                           |
| Merge strategy | User edits are never overwritten. New fields may be added by `arbiter update` with defaults. |

### Hook scripts (.claude/hooks/\*.mjs)

| Property       | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Default paths  | `.claude/hooks/*.mjs`                                                                               |
| Status         | **evolving**                                                                                        |
| User-editable  | No — arbiter-managed. Customizations should use the extension points in each hook's config section. |
| Merge strategy | Regenerated on `arbiter update`. Local modifications are overwritten unless versioned via plugin.   |

### CONTRIBUTING.md (arbiter-generated section)

| Property       | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Default path   | `CONTRIBUTING.md`                                            |
| Status         | **evolving**                                                 |
| User-editable  | Outside the generated section, yes.                          |
| Merge strategy | arbiter-managed section regenerated; user section preserved. |

---

## Generated-content manifest & fix propagation (#1328, INV-122)

**Issue:** #1328

Many files are emitted with `skipIfExists` — once present, a plain re-run leaves them alone so user
edits survive. Historically that meant `arbiter update` could **never** deliver an upstream template fix
to such a file (a validator script, `check-all.mjs`, `.githooks/pre-push`): the stale copy lived forever,
and `arbiter diff` reported it as `(unchanged)` without comparing content — a parity report that lied.

Arbiter now records a per-file content-hash **manifest** so it can tell the two cases apart:

| File         | Value                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Default path | `.arbiter-generated-manifest.json` (project **root**, sibling of `.arbiter-generated.json`)                                              |
| Status       | **evolving**                                                                                                                             |
| Committed?   | **Yes — commit it.** It must travel with the repo or the governed fleet cannot inherit fixes. It is intentionally NOT under `.arbiter/`. |
| Shape        | `{ "$schemaVersion": 1, "files": { "<posix-relpath>": "<sha256-of-arbiter's-last-render>" } }`                                           |

### Update / diff semantics for `skipIfExists` files

On `arbiter update` (and the read-only `arbiter diff`), for each `skipIfExists` file that already exists:

- **on-disk content == current render** → `skipped` (already up to date).
- **on-disk hash == the recorded manifest hash** (pristine — unmodified since arbiter generated it) and
  the template changed → **rewritten** to the new render. The fix propagates. `diff` reports `changed`.
- **on-disk hash ≠ the recorded manifest hash** (you edited it) → **preserved**, with a warning:
  `user-modified, template fix NOT applied: <path>`. Delete the file and re-run `arbiter update` to take
  the current template.

`update` persists the manifest before writing `arbiter.json`/`.arbiter-generated.json`, so those two are
never recorded as manifest entries. Plugin- and `doctor`-written files keep the legacy skip-always
behavior (out of scope for the manifest).

> **Selective vs full update.** When a config change maps to a _subset_ of generators, `arbiter update`
> runs only that subset, so a pristine-stale file owned by a non-impacted generator is not rewritten that
> run (its baseline is preserved, not poisoned). A no-config-change `update` — the common path after an
> arbiter version bump — runs the full registry and re-evaluates every `skipIfExists` file, propagating
> all pending fixes. So if a fix does not land after a config-only update, re-run `arbiter update`.

### First run, corruption, and `doctor repair-state`

- **No manifest yet** (a project initialised by an older arbiter, or before this feature) → every
  `skipIfExists` file is treated as user-modified and conservatively skipped on the first run. Run one
  `arbiter update` to establish baselines; subsequent template fixes then propagate. To force-adopt a
  stale file immediately, delete it and re-run `arbiter update`.
- **Corrupt/unparseable manifest** → `arbiter update` fails closed (exit 2). It is never silently treated
  as empty (that would withhold fixes fleet-wide while exiting 0).
- `arbiter doctor repair-state` re-derives `.arbiter-generated.json` from `arbiter.json` but **cannot**
  re-derive the manifest (hashes are not a function of config). It warns accordingly; re-run
  `arbiter update` if you suspect drift.

### Threat model

The manifest is trusted **because it is committed** — integrity is the repo's git history, not an in-file
checksum (so there is none, by design). Tampering is bounded and recoverable in both directions: a forged
hash can only (a) make a pristine file look modified → a fix is withheld (`diff` still tells the truth by
comparing content), or (b) make a modified file look pristine → it is overwritten with arbiter's own
canonical template render, and the prior bytes are recoverable from git. No code execution, secrets, or
privilege are involved — only which of two known, safe renders lands.

---

## CI Gate

Adding or removing a field in a `stable` file's generated schema without a corresponding MAJOR semver bump fails the gate. See [docs/SEMVER.md](../SEMVER.md).
