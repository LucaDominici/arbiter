---
title: 'Process — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-06-08'
owner: ''
canonical_id: 'PROCESS'
tags: ['audience/dev', 'kind/method']
related: []
---

# Process — arbiter

Consolidated process reference: the work-scope track model, post-commit track classification, doc-version semver policy, and the RFC process. Sections below were previously separate files.

---

## Track Model — arbiter

**Purpose:** Define the work-scope taxonomy used to delimit a task. Each
arbiter task belongs to exactly one _track_. A track scopes:

- Which CODEOWNERS reviewers are recruited.
- Which gate subset must pass before the work merges.
- Which excerpts the CONTEXT_PACK emitter selects by default.

**Location:** `docs/METHOD/TRACK_MODEL.md`
**Pairs with:** the CONTEXT_PACK emitter (`scripts/emit-context-pack.mjs`), whose per-track defaults this model informs.

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

---

## Post-Commit Track Taxonomy (#724)

Arbiter's `post-commit-check.mjs` hook classifies changed files into tracks and prints stack-specific verification reminders. This document defines the taxonomy, per-stack checklists, and extension guide.

## Tracks

| Track        | Triggered by                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **frontend** | Extensions: `.tsx?`, `.jsx?`, `.vue`, `.svelte`, `.css`, `.scss` — or path prefix `web/`, `frontend/`  |
| **backend**  | Extensions: `.go`, `.py`, `.java`, `.rs`, `.rb` — or path prefix `api/`, `backend/`, `server/`, `cmd/` |
| **docs**     | Extension: `.md` — or path prefix `docs/`                                                              |

A commit can trigger multiple tracks simultaneously. Output order is always `frontend → backend → docs`.

### Canonical Regex (single source of truth)

`scripts/detect-track.mjs` exports `TRACK_PATTERNS`:

```js
FE_RE: /\.(tsx?|jsx?|vue|svelte|css|scss)$|^(web|frontend)\//
BE_RE: /\.(go|py|java|rs|rb)$|^(api|backend|server|cmd)\//
DOCS_RE: /\.md$|^docs\//
```

The self-config hook (`.claude/hooks/post-commit-check.mjs`) imports these via dynamic `await import()`.  
Generated target hooks have equivalent regexes baked in at `arbiter init` render time.

> **Divergence note**: `pre-task-track-detect.mjs.ejs` intentionally extends `FE_RE` (adds `.html`) and `BE_RE` (adds `.php`) because it also matches prompt-text keywords. These are NOT the canonical regexes and are maintained separately.

### Ambiguity: Path Prefix vs Extension

When a file matches both a FE path prefix and a BE extension (e.g., `frontend/server.go`), **both** tracks are emitted. Extension and path-prefix checks are independent. Tests in `__tests__/unit/detect-track.test.ts` pin this behavior.

### CRLF Handling

`git diff --name-only` emits CRLF on Windows. `detectTracks()` strips `\r` before matching to prevent silent detection failure.

## Per-Stack Checklists

Checklists are baked into the generated hook at `arbiter init` time from EJS partials:  
`src/templates/claude/hooks/post-commit-checklists/<stack>/<track>.ejs`

### TypeScript (`ts`)

| Track | Commands                                                   |
| ----- | ---------------------------------------------------------- |
| FE    | `vitest run --reporter dot`, `tsc --noEmit`, snapshot diff |
| BE    | `vitest run --reporter dot`, `eslint src`                  |
| Docs  | `node scripts/check-doc-links.mjs`, verify links           |

### Java

| Track | Commands                                               |
| ----- | ------------------------------------------------------ |
| FE    | `mvn -q test` (JUnit), Selenium/Playwright             |
| BE    | `mvn -q test -Dtest='*IT'`, JaCoCo coverage            |
| Docs  | `javadoc --no-html-validation`, `@see`/`{@link}` check |

### Go

| Track | Commands                                   |
| ----- | ------------------------------------------ |
| FE    | `go test -race ./...`, `go vet ./...`      |
| BE    | `go test -race ./...`, `golangci-lint run` |
| Docs  | `go doc ./...`, link check                 |

### Python

| Track | Commands                                |
| ----- | --------------------------------------- |
| FE    | `pytest -x`, `coverage run --branch`    |
| BE    | `pytest -x --tb=short`, `mypy --strict` |
| Docs  | `mkdocs build --strict`                 |

### Rust

| Track | Commands                                       |
| ----- | ---------------------------------------------- |
| FE    | `cargo test`, `cargo clippy -- -D warnings`    |
| BE    | `cargo test`, `cargo clippy -- -D warnings`    |
| Docs  | `cargo doc --no-deps --document-private-items` |

## How to Extend

### Adding a new track

1. Add regex to `scripts/detect-track.mjs` `TRACK_PATTERNS`
2. Update unit tests in `__tests__/unit/detect-track.test.ts`
3. Add partial stubs for each stack: `src/templates/claude/hooks/post-commit-checklists/<stack>/<new-track>.ejs`
4. Update `post-commit-check.mjs.ejs` to include the new partial
5. Update bloat baseline: `node scripts/update-bloat-baseline.mjs --task=#NNN`

### Adding a new stack

1. Create partials: `src/templates/claude/hooks/post-commit-checklists/<new-stack>/{frontend,backend,docs}.ejs`
2. Add `<new-stack>` to the `_stackMap` in `post-commit-check.mjs.ejs`
3. Add render tests in `__tests__/templates/post-commit-checklist-render.test.ts`
4. Update bloat baseline

## Related

- ADR-043 (`docs/SYSTEM/DECISIONS.md`) — design history and completion note
- `scripts/detect-track.mjs` — canonical regex source
- `__tests__/unit/detect-track.test.ts` — behavior specs
- `src/templates/claude/hooks/post-commit-check.mjs.ejs` — generated hook template

---

## Document Semver Policy (`doc_version`)

Defines how the `doc_version:` frontmatter field on hand-authored .md docs is
bumped.

`doc_version` is **per-document content versioning** and is intentionally
distinct from the **product semver** described in [`../../SEMVER.md`](../../SEMVER.md).
The product semver governs the `@arbiter/cli` package; `doc_version` governs
the meaning of an individual document. Two axes, two registers.

## When to bump

### MAJOR (X.0.0)

| Trigger                                                                |
| ---------------------------------------------------------------------- |
| Section removed without an alias in `CANONICAL_PATHS.md`               |
| Stated policy reversed (e.g. recommendation flipped to anti-pattern)   |
| Document supersession (frontmatter `status: deprecated` or `archived`) |
| Schema of a referenced artifact changed in a way readers must re-learn |

### MINOR (x.Y.0)

| Trigger                                                                      |
| ---------------------------------------------------------------------------- |
| New section added                                                            |
| New rule added to an existing list (e.g. INV-NN appended to invariant table) |
| New example, diagram, or worked-through scenario                             |
| Expanded scope of existing content (audience widened, additional rationale)  |

### PATCH (x.y.Z)

| Trigger                                     |
| ------------------------------------------- |
| Typo fix, grammar polish, formatting        |
| Link target updated to a canonical path     |
| Wording clarified without changing meaning  |
| Line counts refreshed in `KNOWLEDGE_MAP.md` |

## Defaults

- New documents start at `doc_version: "1.0.0"`.
- The frontmatter codemod (`scripts/docs-add-frontmatter.mjs`) sets `1.0.0`
  for every doc that lacks the field; subsequent edits MUST bump per the
  matrix above.

## Conflicts with product semver

The two axes never share a number. A doc-only PR that bumps `doc_version`
on a single file does NOT bump the `@arbiter/cli` package version. A product
MAJOR release does NOT bump every `doc_version` to MAJOR.

If a product MAJOR change requires docs to be rewritten, the _affected_
docs bump their own MAJOR independently when their content changes.

## Verification

`scripts/check-doc-style.mjs` (planned, P8) enforces:

- Every required frontmatter key is present
- `doc_version` matches the semver shape `\d+\.\d+\.\d+`
- `last_review` is ISO date format
- `status` is one of `draft | active | deprecated | archived`

Until P8 ships, the codemod's `--check` mode is the de facto guard.

---

## RFC Process

Arbiter uses a lightweight RFC (Request for Comments) process for significant changes — new plugin API surfaces, new governance levels, changes to the skills matrix schema, and anything that would break existing integrations.

Small bug fixes, doc improvements, and minor enhancements do **not** need an RFC — open a regular issue.

---

## When to write an RFC

Write an RFC when your change:

- Modifies the public plugin API (`ArbiterPlugin`, `PluginContext`, `PluginResult`)
- Adds or removes a governance level
- Changes the skills-matrix schema or detect-and-reference posture
- Alters `AGENTS.md` generated structure in a way that requires existing projects to update
- Introduces a new CLI flag that affects generated artifacts

---

## Process

1. **Copy** `docs/rfc/0000-template.md` to `docs/rfc/NNNN-short-title.md` (replace `NNNN` with the next available number).
2. **Fill in** all sections. "Unresolved Questions" is required — leave it empty only if there genuinely are none.
3. **Open a PR** with just the RFC file. Set the PR title to `RFC NNNN: <short title>`.
4. **7-day comment window** — the PR stays open for at least 7 calendar days after the last substantive edit.
5. **Acceptance** requires: ≥1 maintainer approval + ≥1 community contributor approval (or a second maintainer if no community approval within 14 days).
6. **Merge** the RFC as `accepted` and set `status: accepted` in the frontmatter.
7. **Deferred** RFCs are closed with `status: deferred` and a summary of why.

Implementation PRs link back to the accepted RFC with `Implements RFC NNNN`.

---

## RFC numbering

RFCs are numbered sequentially. The first accepted RFC is `0001`. The accepted-RFC
index and the RFC template are compiled into the generated wiki (Obsidian viewer).
