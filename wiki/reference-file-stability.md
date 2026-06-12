---
generated: true
source: 'docs/REFERENCE/file-stability.md'
source_sha: '3105629b14f38fc0b7c8bc6bebc12d950d65454c'
last_updated: '2026-06-12'
---

# Generated File Format Stability Map

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/file-stability.md](../docs/REFERENCE/file-stability.md)

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
  `user-modified, template fix NOT applied: <path>

*[content truncated — see source for full text]*
