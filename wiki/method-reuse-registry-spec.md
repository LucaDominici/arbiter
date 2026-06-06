---
generated: true
source: 'docs/METHOD/REUSE_REGISTRY_SPEC.md'
source_sha: 'cd29d14bd98c90f113ead16da5de94a79ede07f2'
last_updated: '2026-06-06'
---

# REUSE_REGISTRY Specification — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/REUSE_REGISTRY_SPEC.md](../docs/METHOD/REUSE_REGISTRY_SPEC.md)

# REUSE_REGISTRY Specification — arbiter

**Purpose:** Define the file-level registry of shared reusable modules and the
protocol for looking them up before creating new code (CANON-16 survey).

**Location:** `docs/METHOD/REUSE_REGISTRY_SPEC.md`
**Registry:** `docs/METHOD/REUSE_REGISTRY.md`

> Not to be confused with `docs/METHOD/PATTERNS_CATALOG.md`, which registers
> _directory-level patterns_ (architectural slots). REUSE_REGISTRY operates one
> level lower: individual files and their exported API surface.

---

## Purpose

The registry is the first lookup stop for the CANON-16 refactor-first survey.
Before opening any new file under `src/` or `scripts/`, a contributor checks
this registry to determine whether the needed utility already exists.

A registry hit means:

- Reuse the registered module directly, or
- Extend it via a parameter or overload if the variation is small and coherent.

A registry miss justifies creating a new file, but the new file's PR MUST add
its entry to `docs/METHOD/REUSE_REGISTRY.md` before merge.

---

## Acceptance criteria

A module qualifies for registration when ALL of the following hold:

1. **Exported** — the module provides one or more named exports consumed via
   `import` or `require` in calling files.
2. **Shared** — used by ≥2 distinct source files, OR extracted by explicit
   policy (e.g. `scripts/lib/run-helpers.mjs` mandated by CANON-01).
3. **Tested** — has at least one unit test, or is covered indirectly by
   integration tests in the gate suite.

Utilities used entirely within a single file (e.g. private helpers inlined
without export) are not registered.

---

## Entry schema

Each entry occupies a third-level heading under its tier section in
`docs/METHOD/REUSE_REGISTRY.md`. Fields are a flat bullet list. All fields
are required except `deprecated_in` and `replaced_by`.

```text
### <module-slug>
- path: <repo-relative path>
- purpose: <one-sentence description>
- key_exports: <comma-separated exported names, max 5; use "(see source)" if many>
- when_to_use: <scenario where this module is the right choice>
- when_to_avoid: <scenario where callers should look elsewhere>
- tests: <test file path(s), "indirect via <file>", or "none">
- since: <semver when the module was introduced, e.g. 0.1.0>
- deprecated_in: <semver where deprecated; omit if still active>
- replaced_by: <path to successor; required when deprecated_in is present>
```

The heading slug is the filename without extension. The `path` field is
repo-relative POSIX notation.

---

## CANON-16 survey integration

CANON-16 (`docs/SYSTEM/CANON.md`) requires a refactor-first survey before any
new file is created under `src/`, `src/generators/`, `src/templates/`, or
`src/commands/`. The survey protocol for this registry:

1. Search `docs/METHOD/REUSE_REGISTRY.md` for entries whose `purpose` or
   `key_exports` overlap with the intended functionality.
2. If a match is found: reuse or extend the registered module. Document the
   decision in the plan: `"Existing Code Survey: found <path> in
REUSE_REGISTRY; reused by <description>."`
3. If no match is found: document the miss: `"Existing Code Survey: checked
REUSE_REGISTRY, no similar entry found."`

A plan that proceeds to file creation without citing this survey is incomplete
per CANON-16.

---

## Registration protocol

**Adding a module:**

The PR that introduces a new shared module MUST include the registry entry in
the same diff. Reviewers block merge until the entry is present.

**Removing a module:**

1. Add `deprecated_in: <version>` and `replaced_by: <path>` to the entry.
2. Do NOT delete the entry — historical presence is preserved for audit.
3. Remove the module file in the same PR.

**Modifying a module:**

Update `purpose`, `key_exports`, `when_to_use`, or `when_to_avoid` in the same
PR as the API change. No separate docs-only PR needed.

---

## Non-goals

This registry does NOT cover:

- External npm packages — use `package.json` and `node_modules`.
- EJS templates under `src/templates/` — governed by CANON-04.
- Generators under `src/generators/` — governed by CANON-11.
- CLI commands under `src/commands/` — governed by CANON-06.
- Test fixtures and test helpers under `__tests__/`.
- Docs and configuration files.

---

## Relation to PATTERNS_CATALOG

`docs/METHOD/PATTERNS_CATALOG.md` registers **directory-level patterns**: which
architectural slot (`src/detectors/`, `src/verify/`, `src/kit/`, …) to use when
adding a new subsystem, plus design rationale. Its entries describe patterns, not
individual files.

REUSE_REGISTRY operates at the file level. Both documents serve CANON-16:

1. Read PATTERNS_CATALOG first to identify the right architectural slot.
2. Then read REUSE_REGISTRY to find existing implementations inside that slot.

---

## Stability

Schema additions are minor revisions and bump `doc_version`'s second digit.
Field removal or semantic changes bump the major digit and require a migration
pass over all entries in `REUSE_REGISTRY.md`.

## See Also

- [[method-patterns-catalog]] — related
- [[method-canonical-paths]] — related
