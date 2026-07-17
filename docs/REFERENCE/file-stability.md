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

| Property       | Value                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Default path   | `GLOBAL_INVARIANTS.md`                                                                                 |
| Status         | **stable**                                                                                             |
| User-editable  | No — fully managed by arbiter. Custom documentation belongs in AGENTS.md.                              |
| Merge strategy | Fully regenerated on `arbiter update`, unless the file carries the preserve marker (#1980; see below). |

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

| Property       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default path   | `package.json` (`devDependencies` only)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Status         | **stable**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| User-editable  | Yes — arbiter only **adds** a missing tool devDependency, never overwrites an existing one.                                                                                                                                                                                                                                                                                                                                                                                               |
| Merge strategy | Tool gates (jscpd, pact, …) inject a **registry-pinned** version via `injectDevDependency`. arbiter itself is **not** injected — governed projects invoke it via `npx` (option C). Volatile install channels (`file:`/`link:`/`portal:`/local `.tgz`) are **rejected at the choke-point** so a machine-specific reference can never be emitted (the AF-003 rot from a prior internal project). A registry/pinned-tag arbiter dependency is the future A-flip, deferred to public release. |

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
- **on-disk hash ≠ the recorded manifest hash** (you edited it) → **preserved**, and the withheld fix is
  surfaced (#1344): `diff` reports the file with status `withheld` (no longer a lying `unchanged`), and
  `update`'s summary counts it (`… N withheld`). Delete the file and re-run `arbiter update` to take the
  current template, or merge the upstream change manually.

### Visibility of withheld fixes (`diff --withheld`)

**Issue:** #1344

Anti-clobber (#1328) is correct, but a withheld fix that never lands is silent, cumulative drift — the
more a client personalises, the more upstream gate/security fixes stay out without anyone noticing. So the
withheld set is now a first-class, reviewable signal:

- `arbiter diff` lists withheld files under a dedicated **"Withheld template fixes"** section (status
  `withheld`), distinct from `unchanged`. JSON output carries `files[].status === "withheld"` plus a
  `withheldCount`. A withheld fix counts as a change (exit 1 / `warning`), so CI can flag drift.
- `arbiter diff --withheld` filters the report to **only** the withheld entries — a focused reconciliation
  list for deciding which upstream changes to merge into your customised files.
- `arbiter update` reports the withheld tally in its summary so an operator running `update` sees the
  drift directly, not just a buried per-file warning.

A withheld fix does **not** count as a pending write: `hasChanges` (the run-update hint and the
idempotence contract) stays write-only, so `update` → `diff` remains idempotent. Withheld drift is
reported through the dedicated section + `withheldCount`, and the JSON status is `warning` (exit 1) when
any withheld fix exists, so CI can flag it without claiming `update` would rewrite the file.

> **Known limitation (#1349).** A generated file that arbiter post-formats with prettier (e.g.
> `.codex/codex-adapter.mjs`) can appear as `withheld` even when untouched: `writeFile` records the
> pre-format render hash while prettier rewrites the on-disk bytes, so the baseline and disk no longer
> match. This is arbiter's own formatting, not a user edit — tracked for a root fix (in-memory format
> before hashing).

> Future work (tracked separately): 3-way merge assist for withheld files, and elevating
> gate/security-critical fixes to an explicit "force-review" action keyed off this `withheld` status.

`update` persists the manifest before writing `arbiter.json`/`.arbiter-generated.json`, so those two are
never recorded as manifest entries. Plugin- and `doctor`-written files keep the legacy skip-always
behavior (out of scope for the manifest).

### Preserve marker — opting a file out of every future overwrite (#1980)

**Issue:** #1980

A handful of arbiter-generated files (e.g. `GLOBAL_INVARIANTS.md`) are written unconditionally on every
`arbiter update` — they are not `skipIfExists`, so the manifest/withheld machinery above does not apply to
them by default. A governed repo occasionally has a legitimate reason to replace one of these with a
hand-maintained file instead — for example a short pointer stub that redirects to a central/shared
document living elsewhere. Without an explicit signal, `update` cannot tell that divergence apart from
simple drift and overwrites it.

To opt a file out of every future overwrite, include the literal marker string `arbiter:preserve` anywhere
in its content (a comment is the natural place, e.g. `<!-- arbiter:preserve -->` in Markdown/HTML,
`# arbiter:preserve` elsewhere):

- `writeFile` checks for the marker on the **existing on-disk content** before any other write decision.
  When present, the write is **always skipped** — regardless of `skipIfExists`, `backup`, or the `--adopt`
  force-adopt policy (fail-safe: presence of the marker wins over every other flag).
- `arbiter update`'s summary counts a preserve-marked file under the same **withheld** tally reported for
  `skipIfExists` files, since the visible contract is identical: "this file diverged from the template on
  purpose, delete it to let arbiter regenerate it."
- This applies to **every** `writeFile` call site (all generators), not just files that also set
  `skipIfExists` — it is the mechanism that makes `GLOBAL_INVARIANTS.md` (and any other unconditionally
  regenerated file) overridable at all.
- To take the current template again, delete the marker (or the whole file) and re-run `arbiter update`.

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

### Secret-scanning interaction (#1358)

Because the manifest is committed and its entries are `path → sha256` content hashes, gitleaks'
`generic-api-key` rule would otherwise flag the 64-hex values as secrets and block the push. The
generated `.gitleaks.toml` therefore path-allowlists `.arbiter-generated-manifest.json` (the values
are hashes, never secrets). Do not git-ignore the manifest — it is fleet provenance and must be committed.

### Format-before-write (#1349)

For the few files arbiter formats to the target's prettier style (`.codex/codex-adapter.mjs`, the
TypeScript BDD files), the generator formats the content **in-memory before** `writeFile` records the
render hash (`formatContent` via `prettier --stdin-filepath`), rather than rewriting the file on disk
afterwards. This keeps `manifest[key] === sha256(disk)` by construction — a post-write reformat would
otherwise desync the baseline and surface the file as a false-positive withheld fix, making `update`
non-idempotent.

---

## CI Gate

Adding or removing a field in a `stable` file's generated schema without a corresponding MAJOR semver bump fails the gate. See [docs/SEMVER.md](../SEMVER.md).
