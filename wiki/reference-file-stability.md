---
generated: true
source: 'docs/REFERENCE/file-stability.md'
source_sha: 'ff181e1963eaf72e3553a723094be20ede93b1af'
last_updated: '2026-06-13'
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

### package.json — injected dev-dependencies (#1314)

| Property       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default path   | `package.json` (`devDependencies` only)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Status         | **stable**                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| User-editable  | Yes — arbiter only **adds** a missing tool devDependency, never overwrites an existing one.                                                                                                                                                                                                                                                                                                                                                                       |
| Merge strategy | Tool gates (jscpd, pact, …) inject a **registry-pinned** version via `injectDevDependency`. arbiter itself is **not** injected — governed projects invoke it via `npx` (option C). Volatile install channels (`file:`/`link:`/`portal:`/local `.tgz`) are **rejected at the choke-point** so a machine-specific reference can never be emitted (the haben AF-003 rot). A registry/pinned-tag arbiter dependency is the future A-flip, deferred to public release. |

### Hook scripts (.claude/hooks/\*.mjs)

| Property       | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Default paths  | `.claude/hooks/*.mjs`                                                                               |
| Status         | **evolving**                                                                                        |
| User-editable  | No — arbit

*[content truncated — see source for full text]*
