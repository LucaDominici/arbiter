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

Only the merge is bespoke; the write is not (#2120). The merged result goes through the ordinary
`writeFile` path, so `.claude/settings.json` is recorded in the generated manifest, honours the
`arbiter:preserve` marker (see below) and is written atomically. Until it did, this was the one emitted
file no protection mechanism reached — the generator compared, backed up and wrote it by hand. JSON has no
comments, but the marker is a whole-file substring test, so an ordinary key carries it:
`{ "_arbiter": "arbiter:preserve", … }`.

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

`projectName` is one of those fields (#2120). It is resolved on every run through the precedence chain
`arbiter.json` → `package.json` `name` → git remote → directory basename (#1978), and `arbiter update` now
writes the resolved value back. Until it did, a repo whose `arbiter.json` predated the key resolved to its
`package.json` name on _every_ run — so a project named differently from its package (`acme` vs
`acme-tooling`) was silently renamed in every generated artifact, update after update. Set the key
explicitly to pin the name; the first `update` pins it for you otherwise.

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

> Future work (tracked separately): 3-way merge assist for withheld files. The other half of this note —
> elevating gate-critical fixes out of "withheld forever" — landed as the gate-spine protected class
> (#2109), documented below.

`update` persists the manifest before writing `arbiter.json`/`.arbiter-generated.json`, so those two are
never recorded as manifest entries. Plugin- and `doctor`-written files keep the legacy skip-always
behavior (out of scope for the manifest).

### What `--adopt-plan` shows — all three write channels (#2120)

**Issue:** #2120

`arbiter update` puts bytes on disk through three channels, and the preview used to show one:

| channel                     | condition                                           | preview before #2120 |
| --------------------------- | --------------------------------------------------- | -------------------- |
| adopt                       | `skipIfExists` + diverged + an adopt policy matches | shown                |
| regenerate (always-rewrite) | `skipIfExists: false` — overwritten unconditionally | **hidden**           |
| pristine rewrite            | `skipIfExists` + on-disk hash == manifest           | **hidden**           |

The information was never missing, only discarded: the plan's dry run already resolves the prospective
action for every emitted file (`writeFile` in `dryRun` classifies without writing), and `runAdoptPlan`
dropped that array one line after computing it. `update --adopt-plan` now prints, alongside the adoption
list:

- **would regenerate** — files whose action resolves to `replaced` / `backed-up-and-replaced` and that are
  not withheld. This is the channel that silently reverts a local fix in an always-rewrite file such as
  `scripts/debt-lib.mjs`.
- **would withhold** — diverged files no adopt policy matches, the same set `diff --withheld` reports.

`skipped` is deliberately NOT a section: it is every unchanged file, and a preview nobody reads protects
nobody. `--json` carries `wouldRegenerate` and `withheld` so the two output channels cannot disagree.

`arbiter diff` models the same adopt policy (#2120). It used to open its generation session without an
adopt predicate, so every file `update` force-adopts — the safety class, the gate spine, and now the
governance pair — was reported as a preserved "withheld template fix" with a reconcile hint, when the very
next `update` overwrites it. `diff` now reports those as `changed`, which is what they are: a file that is
`withheld && adopted` is diverged-and-re-adopted, not preserved. `diff` stays read-only — it takes the
classification, never the `onAdopt` side effect.

### Provenance for always-rewrite files (#2120)

**Issue:** #2120

The pristine test (`sha256(disk) == manifest hash`) used to live INSIDE the `skipIfExists` branch. A file
emitted with `skipIfExists: false` — `scripts/debt-lib.mjs`, the `scripts/gen-*.mjs` family, most emitted
scripts — was therefore overwritten with **no provenance check at all**: a local fix was silently reverted
by every `arbiter update`, and nothing anywhere reported it. The check now runs ahead of the branch, so an
always-rewrite file gets exactly the same treatment as a `skipIfExists` one when it diverges: `withheld`,
listed in `diff --withheld` and in the `--adopt-plan` preview, adoptable with `--adopt`, reversible via the
local-override envelope.

Narrowed deliberately to **positive evidence of divergence**:

| manifest entry | disk vs. baseline | `skipIfExists: false` result |
| -------------- | ----------------- | ---------------------------- |
| present        | equal (pristine)  | rewritten (fix propagates)   |
| present        | differs           | **withheld** (new)           |
| absent         | —                 | rewritten (unchanged)        |

Unknown provenance keeps replacing. Withholding it would make `arbiter update` a silent no-op on any repo
whose manifest predates the key — the same silence in the opposite direction, and a worse one, because it
would stop governance propagating everywhere at once.

### Protected classes — three classes, and only two of them adopt by default

Three classes of emitted file get special treatment when the on-disk copy is user-modified. **Two adopt by
default** (safety, governance): the shipped render lands over the local edit, recording a reversible
`.arbiter/evidence/local-overrides/<slug>.json` envelope with the prior content verbatim. **One withholds by
default** (gate spine, since #2119) and adopts only under an explicit opt-in, with the same reversible
envelope when it does. Safety and gate spine are both backstopped by
`scripts/check-safety-adopt-ratchet.mjs`, which fails the governed project's gate for as long as a member of
either class stays withheld and unmarked.

| class              | pattern                                      | default  | flag                           |
| ------------------ | -------------------------------------------- | -------- | ------------------------------ |
| safety (T1)        | `.claude/hooks/*.mjs`                        | adopt    | `--no-adopt-safety` (opt out)  |
| gate spine (#2119) | `scripts/check-all.mjs`, `scripts/lib/*.mjs` | withhold | `--adopt-gate-spine` (opt in)  |
| governance (#2120) | `AGENTS.md`, `.claude/settings.json`         | adopt    | `arbiter:preserve` marker only |

`--no-adopt-gate-spine` is still accepted as a no-op, so a consumer script written during the #2119
moratorium keeps working.

The first two are monotonic by directory: a hook or a `scripts/lib/` helper added later is covered without
the pattern changing. The two flags are deliberately independent — opting into gate-spine adoption must not
change safety-hook policy, and vice versa.

**Why governance is a class, and why it is exactly two files.** `AGENTS.md` (Iron Laws) and
`.claude/settings.json` (the `ARBITER_*` deny list) are re-rendered on every selective update on purpose
(#2056) because both render from the whole config plus their templates, so either can carry updated
governance content independent of which config field changed — leaving them stale is the root cause behind
the #2040 downstream-consumer drift. The provenance test above would have frozen exactly these two for
anybody who touched them, re-opening that drift through the back door. Adopting them by default keeps #2056
working while the overwrite becomes **visible** (named in `--adopt-plan`, announced in the run summary) and
**reversible** (prior bytes verbatim in the local-override envelope) — which the silent overwrite never
was. The class is an explicit pair rather than a pattern so it cannot quietly grow to mean "anything that
looks governance-ish": it is bounded by what #2056 force-renders. There is no `--no-adopt-governance` flag;
a project that genuinely wants one frozen marks it `arbiter:preserve`, which is checked ahead of every
adopt policy and works in JSON as an ordinary key.

**Why the gate spine is withheld and not adopted (#2119 reverses #2109).** Adoption is only safe when the
template render is a **superset** of the local file. That holds for `.claude/hooks/*.mjs`: those are whole
files arbiter owns, and a project has no legitimate content of its own inside them. It does **not** hold for
`scripts/check-all.mjs`, which is by construction the point where a project wires its OWN checks —
customization _is_ that file's function. #2109 read the spine as a container arbiter owns and force-adopted
it; measured afterwards on a copy of a real governed consumer, a **bare** `arbiter update` (no `--adopt`, no
flag at all) deleted **25 project checks, 12 of them security** — container hardening, auth-bypass, cookie
hardening, crypto primitives, SQLi regression, distroless runtime, error disclosure, workflow hardening and
more — and **the gate stayed green**, because the checks did not fail: they disappeared. That is why the
default is now to withhold, and `--adopt-gate-spine` is an explicit, destructive opt-in.

**Not in the class: `scripts/check-*.mjs` leaf checks.** A leaf check is exactly where a project
legitimately tunes its own thresholds; force-adopting those would overwrite intent rather than restore a
fix. They stay `skipIfExists` and surface through `diff --withheld` like any other file.

**Accepted cost.** A project that customized its gate spine stops receiving spine fixes — and every check
arbiter ships later that its `check-all.mjs` does not wire. `check-safety-adopt-ratchet.mjs` stays **red**
for exactly that reason: the red is the register of that debt, not a bug to silence. It clears in one of
three honest ways — wire the new checks into your own `check-all.mjs` by hand (run `arbiter diff` to see
what the template would add), mark the file `arbiter:preserve` when the divergence is permanent (the
documented exception the ratchet accepts), or run the destructive `arbiter update --adopt-gate-spine` after
previewing it with `--adopt-plan`. A **pristine** spine — untouched since arbiter generated it — is
unaffected and keeps receiving every fix automatically.

### Refreshing codex-track derived files (`update --refresh-derived`, #1983)

**Issue:** #1983

A specific subset of `skipIfExists` files — the codex-track files DERIVED from the canonical Claude
rule templates (`.agents/rules/*`) plus the codex hook/adapter bridge (`.claude/hooks/*` on a codex-only
project, `.codex/codex-adapter.mjs`) — has the same erosion exposure as any other `skipIfExists` file:
once materialized in a governed repo, a later upstream template fix (e.g. a new CANON-22-class section
landing in `90-exec-protocol.md.ejs`) never reaches it through a plain `arbiter update`.

`arbiter update --refresh-derived` is the opt-in escape hatch, modeled on the `--adopt` two-phase
plan/apply flow (#1926) documented above:

- The refresh set is derived from the SAME declarative sources the generators consume
  (`CODEX_DERIVED_RULES` in `src/generators/codex-known-limitations.ts`, `SHARED_GUARD_HOOKS` in
  `src/generators/codex-hooks.ts`) via `src/generators/derived-class.ts` — never a hand-copied path list,
  so the refresh set and the actual emission can never independently drift.
- Combine with `--adopt-plan` to preview the per-file diff (current on-disk content vs. the fresh
  emission for the repo's resolved config) before writing anything.
- Byte-identical files are skipped silently. A file carrying the `arbiter:preserve` marker (see above,
  #1980) is **never** overwritten, even with `--refresh-derived` — reported as preserved, same as any
  other preserve-marked file.
- This flag changes nothing about the DEFAULT emission set — a fresh `arbiter init`/`arbiter update`
  without the flag still emits these files `skipIfExists: true` exactly as before. `--refresh-derived` only
  widens the force-write predicate for an explicit, opt-in run.

**Related, not built here:** a possible future sibling — a materialized-mode parity check that scans a
_downstream governed repo's_ live `.agents/**`/`.codex/**` the way `scripts/check-codex-self-parity.mjs`
(ADR-106) does for arbiter's own tree — is out of scope for #1983. See
`docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md` §Self-track parity for that gate's current, arbiter-only
scope.

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

Doctor subcommands accept `--dir` and `--json` after the subcommand name. These options apply to
the selected operation (for example, `arbiter doctor repair-state --dir /repo --json` repairs that
repository and emits its JSON envelope), rather than falling back to the caller's working directory.

When `arbiter update --adopt-gate-spine` force-adopts a withheld `scripts/check-all.mjs`, the spine
has landed and is not reported as an unwired gate. A warning remains for the distinct case where a
user-modified spine was actually withheld and newly generated checks could not be connected.

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
