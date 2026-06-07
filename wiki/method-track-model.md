---
generated: true
source: 'docs/METHOD/TRACK_MODEL.md'
source_sha: 'fd06f688436c8205a8cf678c030fb6f2ee3257a0'
last_updated: '2026-06-07'
---

# Track Model — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/TRACK_MODEL.md](../docs/METHOD/TRACK_MODEL.md)

# Track Model — arbiter

**Purpose:** Define the work-scope taxonomy used to delimit a task. Each
arbiter task belongs to exactly one _track_. A track scopes:

- Which CODEOWNERS reviewers are recruited.
- Which gate subset must pass before the work merges.
- Which excerpts the CONTEXT_PACK emitter selects by default.

**Location:** `docs/METHOD/TRACK_MODEL.md`
**Pairs with:** `docs/METHOD/CONTEXT_PACK_SPEC.md` (track informs pack scope).

> Not to be confused with `docs/METHOD/TRACK_ROUTER.md.ejs` (query routing
> for agents). TRACK_ROUTER tells an agent which doc to read next;
> TRACK_MODEL tells the orchestrator which subsystem a task lives in.

---

## Tracks

Six tracks, fixed vocabulary. Adding a track requires an SSOT amendment.

### `core`

- **Scope:** TypeScript sources under `src/` that ship in the built CLI.
  Excludes templates, generators metadata, and command help text rendered
  from EJS.
- **Owners:** `@arbiter-core` (CODEOWNERS pattern: `src/`).
- **CI gate subset:** L1 lint + L1 type-check + L1 unit tests + dogfood.
- **Agent dispatch hint:** prefer narrow excerpts (touched files only);
  default invariants `INV-04, INV-05, INV-06`.

### `templates`

- **Scope:** EJS templates under `src/templates/` and their materialized
  outputs under `.claude/`, `.github/`, `.agents/`, `.codex/`.
- **Owners:** `@arbiter-templates` (CODEOWNERS pattern:
  `src/templates/ .claude/ .github/ .agents/ .codex/`).
- **CI gate subset:** L1 lint + L1 type-check + dogfood + template render
  tests.
- **Agent dispatch hint:** default canon set includes `CANON-04`,
  `CANON-13`, `CANON-16`; include the materialized output as an excerpt
  alongside the template.

### `kit`

- **Scope:** Tool catalog under `kit/`, archetype manifests, language
  matrices, and adapter coverage. Changes here advertise capability to
  generated projects.
- **Owners:** `@arbiter-kit` (CODEOWNERS pattern: `kit/ src/compatibility/`).
- **CI gate subset:** L1 lint + matrix-fixtures + tool catalog parity.
- **Agent dispatch hint:** default canon set includes `CANON-02`,
  `CANON-03`; include the catalog manifest as an excerpt.

### `docs`

- **Scope:** Hand-authored Markdown under `docs/`, plus root-level docs
  (`README.md`, `AGENTS.md`, `GLOBAL_INVARIANTS.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, `OBSIDIAN.md`). Excludes generated
  docs under `docs/internal/` and API snapshots.
- **Owners:** `@arbiter-docs` (CODEOWNERS pattern:
  `docs/ *.md /AGENTS.md /README.md`).
- **CI gate subset:** L1 lint + check-doc-style + check-doc-links + SSOT
  integrity.
- **Agent dispatch hint:** baseline invariants only; include the touched
  docs as full-file excerpts.

### `ci`

- **Scope:** GitHub Actions workflows under `.github/workflows/`, composite
  actions under `.github/actions/`, and CI-tier templates under
  `src/templates/github/`.
- **Owners:** `@arbiter-ci` (CODEOWNERS pattern:
  `.github/ src/templates/github/`).
- **CI gate subset:** L1 lint + check-action-pins + check-ci-tiers +
  check-evidence-bundle.
- **Agent dispatch hint:** default invariant is `INV-13`; default canon
  set includes `CANON-18`, `CANON-19`.

### `meta`

- **Scope:** Everything else that is governance-relevant but does not fit
  the five tracks above — scripts under `scripts/`, hooks under
  `.claude/hooks/`, the gate script, evidence bundles, license headers,
  and repository-level configuration not owned by another track.
- **Owners:** `@arbiter-meta` (CODEOWNERS pattern: `scripts/ .claude/hooks/`).
- **CI gate subset:** L1 lint + full gate (`node scripts/check-all.mjs`).
- **Agent dispatch hint:** baseline invariants only; do not include
  speculative excerpts.

---

## Tagging a Task

A task declares its track in two places, both required:

1. **GitHub issue label** — `track: <name>` (e.g. `track: core`). Defined
   in `.github/labels.yml`.
2. **Plan frontmatter** — `track: <name>` in the YAML block at the top of
   the plan document. (Validation in the plan-anchor hook lands in a
   follow-up; v1 ships the convention only.)

A task touching more than one track must either be split or, with explicit
approval in the plan, choose the dominant track and document the override.
Cross-track work without that override fails CODEOWNERS review.

---

## Adding or Removing a Track

Track names are a closed vocabulary. To change it:

1. Open an ADR under `docs/ADR/` proposing the change.
2. Update this file in the same PR.
3. Update `.github/labels.yml` (and the EJS source) to add/remove the
   matching `track: <name>` label.
4. Update CODEOWNERS to add/remove the owner pattern.
5. Update `src/templates/root/docs/METHOD/TRACK_MODEL.md.ejs` to keep the
   Level B template in lockstep.
6. Run `node scripts/knowledge-map-update.mjs` after merging.

Renaming a track is a breaking change. Existing labels and frontmatter
references must be migrated in the same PR.

---

## Coverage Invariant

For every track name listed in this file, the following MUST hold:

- A label `track: <name>` exists in `.github/labels.yml` with color
  `cccccc` and a non-empty description.
- The track has a Scope, Owners, and CI gate subset bullet in this file
  with non-empty bodies.

Verified by `__tests__/docs/track-model-coverage.test.ts`.

CODEOWNERS coverage per track (real teams, e.g. `@arbiter-core`) is
declared aspirationally above and will be wired up in a follow-up once
the corresponding GitHub teams exist. Until then the `CODEOWNERS` file
uses repo-wide ownership.
