# Obsidian Vault POC — Design Spec

**Status:** Draft
**Date:** 2026-04-12
**Branch:** `task/obsidian-vault-poc`
**Target POC project:** viafera (as stress-test fixture)

---

## Problem Statement

Arbiter currently generates governance artifacts (AGENTS.md, invariants, skills, GitHub config) as flat markdown files in the target project. For projects with complex PRDs and many interlinked components (e.g., viafera: backend Java + frontend TS + contracts + e2e + infra), navigating these artifacts and understanding _impact when something changes_ is hard. There is no unified view of how invariants, modules, decisions, and open GitHub work relate.

**Goal:** generate an Obsidian vault inside target projects as an optional second brain — a browsable, linked knowledge graph of governance + architecture + PRD templates + GitHub work, kept in sync by arbiter.

## Non-Goals

- AST-level impact analysis (best-effort file/module matching is enough for the POC)
- Canvas generation or Dataview plugin requirement (future work — frontmatter is pre-shaped for Dataview compatibility)
- Bidirectional sync (vault is one-way: arbiter → vault)
- Replacing existing governance files (vault is additive, never removes AGENTS.md / CLAUDE.md / etc.)

## Success Criteria

1. `arbiter init --obsidian` on a fresh project generates a populated `docs/vault/` in under 5 seconds
2. `arbiter obsidian --sync` is idempotent (two consecutive runs → zero diff)
3. Running on viafera produces a vault where Obsidian graph view shows at least 3 navigable clusters (governance, backend, frontend)
4. At least one invariant correctly lists its affected modules via frontmatter
5. User-written PRDs in `docs/vault/prd/` survive sync untouched

---

## Architecture

### Vault Layout

Vault lives at `docs/vault/` inside the target project. Versioned with git.

```
docs/vault/
├── .obsidian/              # graph colors, hotkeys, core plugin config
├── 00-INDEX.md             # home page with links to all sections
├── governance/
│   ├── invariants/
│   │   └── INV-NN.md       # one note per active invariant
│   ├── AGENTS.md           # arbiter AGENTS.md rendered as linkable sections
│   └── decisions/
│       ├── _template.md    # ADR template
│       └── ADR-*.md        # populated from existing docs/SYSTEM/DECISIONS.md when present
├── architecture/
│   ├── modules/
│   │   └── <module>.md     # one note per detected module/package
│   ├── dependencies.md     # inter-module dependency map
│   ├── stack.md            # language, framework, build tool
│   └── impact-map.md       # generated cross-reference invariants ↔ modules
├── prd/
│   ├── _template.md        # PRD template with standard sections
│   └── _impact-template.md # impact analysis template for PRDs
└── github/
    ├── open-issues.md      # index of open issues (from `gh`)
    ├── labels.md           # label → invariant mapping
    └── issues/
        └── NNN.md          # per-issue placeholder notes for backlinks
```

### Frontmatter Shape

Every auto-generated note has YAML frontmatter + a generation marker. Example invariant note:

```markdown
---
id: INV-01
tier: architectural
title: No circular dependencies
status: active
affects-modules: [backend-core, frontend-web]
gh-issues: [123]
tags: [invariant, tier-1]
---

<!-- arbiter:generated source=src/invariants/catalog.ts -->

# INV-01 — No circular dependencies

... body rendered from the same catalog data used by generateAgentsMd ...

## Related

- [[backend-core]]
- [[frontend-web]]
- [[#123 Fix circular import in auth]]
```

The frontmatter is ignored by Obsidian default reading view but is **pre-shaped for Dataview plugin compatibility** — users who install Dataview get dynamic queries for free without a vault rewrite.

### Generation Marker

Auto-generated files have `<!-- arbiter:generated source=<path> -->` as the first line after frontmatter. Files without this marker are never touched by `--sync`. The `source=` field makes provenance debuggable and helps AI agents that read the vault understand where a note came from.

---

## Components

### New Generator: `src/generators/obsidian-vault.ts`

Follows the same pattern as existing generators (`agents-md.ts`, `skills.ts`). Exports:

```typescript
export function generateObsidianVault(config: ProjectConfig): GenerateResult {
  const files: WriteResult[] = [];
  files.push(...generateVaultStructure(config)); // .obsidian/, folders, INDEX
  files.push(...generateInvariantNotes(config)); // governance/invariants/
  files.push(...generateAgentsMdNote(config)); // governance/AGENTS.md (sectioned)
  files.push(...generateDecisionNotes(config)); // governance/decisions/
  files.push(...generateModuleNotes(config)); // architecture/modules/
  files.push(...generateArchitectureNotes(config)); // stack, dependencies, impact-map
  files.push(...generatePrdTemplates(config)); // prd/_template.md, _impact-template.md
  files.push(...generateGithubNotes(config)); // github/ (if useGitHub)
  files.push(...generateIndexNote(config)); // 00-INDEX.md
  return { files };
}
```

### New Templates Directory: `templates/obsidian-vault/`

EJS templates parallel to vault structure. Each template gets the same `ProjectConfig`-derived data object that other generators use, extended with:

- `modules: DetectedModule[]` (from a new `detectModules` helper)
- `githubIssues: GhIssue[]` (from `gh issue list --json`)
- `githubLabels: GhLabel[]` (from `gh label list --json`)

### New Module Detector: `src/detectors/modules.ts`

Best-effort per-language module detection:

- **TypeScript:** parse `package.json` workspaces, fall back to `src/` subdirs
- **Java:** parse `pom.xml` modules / `settings.gradle` includes
- **Go:** `go list ./...` output
- **Rust:** `cargo metadata --format-version 1`
- **Python:** `pyproject.toml` packages or top-level `src/<pkg>/` dirs
- **Unknown:** top-level source directories (`src/`, `lib/`, `backend/`, `frontend/`)

Returns `DetectedModule[]` with `{ name, path, language, kind }`.

### New Command: `src/commands/obsidian.ts`

```typescript
export interface ObsidianOptions {
  sync: boolean;
  dryRun: boolean;
  force: boolean;
  githubOnly: boolean;
  dir: string | undefined;
}

export async function runObsidian(options: ObsidianOptions): Promise<void>;
```

CLI wiring in `src/cli.ts`:

```typescript
program
  .command("obsidian")
  .description(
    "Generate or sync Obsidian vault (requires enableObsidianVault in config)",
  )
  .option("--sync", "Update only auto-generated files, preserve manual content")
  .option("--github-only", "Skip module scan, refresh only github/ notes")
  .option("--dry-run", "Show what would change without writing")
  .option(
    "--force",
    "Run without enableObsidianVault in config (and overwrite non-generated)",
  )
  .option("-d, --dir <path>", "Target directory (default: cwd)")
  .action(runObsidian);
```

### Wizard Addition: `src/wizard/prompts.ts`

Add one optional question after the governance level question:

```
? Generate Obsidian vault? (optional second brain in docs/vault/)
```

Result stored in `config.enableObsidianVault: boolean` and persisted to `.arbiter/config.json`.

### Init Integration: `src/commands/init.ts`

Inside `runGenerators`, after the existing generators:

```typescript
if (config.enableObsidianVault) {
  all.push(...generateObsidianVault(config).files);
}
```

### Types Extension: `src/wizard/types.ts`

```typescript
export interface ProjectConfig {
  // ...existing fields...
  enableObsidianVault?: boolean;
}
```

Persisted in `.arbiter/config.json` via `saveConfig`.

---

## Sync Semantics

**`arbiter obsidian --sync` flow:**

1. Load `.arbiter/config.json`; fail fast if `enableObsidianVault !== true` and `--force` absent
2. Re-run detectors: language, framework, modules, github access
3. Re-query `gh issue list --json` and `gh label list --json` (if github access)
4. For each generator output file:
   - If path does not exist → write it
   - If path exists AND first non-frontmatter line is `<!-- arbiter:generated ... -->` → overwrite
   - If path exists AND no marker → skip (preserve manual content)
5. Compute and display summary: `N generated, M preserved, K new, J unchanged`
6. `--dry-run` stops before any write

**Never touched by sync:**

- `docs/vault/prd/*.md` except the `_template.md` files
- `docs/vault/.obsidian/` after initial generation (respect user customization)
- Any file without the generation marker

**`--github-only`:** skips module re-detection and only refreshes `github/` folder + github-related frontmatter fields.

**Idempotency requirement:** two consecutive `--sync` runs with no external changes must produce a zero-diff result. This is a mandatory integration test.

---

## GitHub Integration ("gh followup")

**Purpose:** wire the vault into the GitHub project board, issues, and labels so the graph view reflects real work state.

**Generated github notes:**

1. **`github/open-issues.md`** — rendered list of currently open issues as wikilinks to per-issue placeholder notes.
2. **`github/issues/NNN.md`** — minimal placeholder for each referenced issue with frontmatter `{ id, title, labels, invariants, state }`. Exists purely to anchor backlinks.
3. **`github/labels.md`** — table mapping labels to invariants using the naming convention `inv-NN` / `tier-N`.

**Cross-links injected into frontmatter of other notes:**

- Invariant notes get `gh-issues: [...]` (issues whose labels reference the invariant)
- Module notes get `gh-issues: [...]` (issues whose labels reference the module name)
- Decision notes get `gh-issue: <N>` when the ADR links to an issue

**Failure mode:** if `gh` is unauthenticated or offline, github notes render with a placeholder banner and sync continues. No hard fail.

**Rate-limit awareness:** `--github-only` exists so users can refresh frequently-changing GitHub state without re-scanning the codebase.

---

## Data Sources Summary

| Vault content                    | Source                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `governance/invariants/INV-*.md` | `src/invariants/catalog.ts` filtered by tier + governance level               |
| `governance/AGENTS.md`           | Same EJS data used by `generateAgentsMd`, rendered with sectioned layout      |
| `governance/decisions/`          | `docs/SYSTEM/DECISIONS.md` when present (viafera-style), else empty template  |
| `architecture/modules/*.md`      | `detectModules()` — per-language best effort                                  |
| `architecture/dependencies.md`   | `madge` (TS), `mvn dependency:tree` (Java), `go list -deps` (Go), best effort |
| `architecture/stack.md`          | Existing `detectLanguage`, `detectFramework`, `detectBuildCommands`           |
| `github/*`                       | `gh issue list`, `gh label list`, `gh pr list`                                |

---

## Testing Plan

### Unit tests (`tests/generators/obsidian-vault.test.ts`)

- Snapshot tests for every EJS template (invariant, module, index, github notes)
- Frontmatter YAML round-trip (`yaml.parse(yaml.stringify(x))` === x)
- Generated files contain the `<!-- arbiter:generated source=... -->` marker
- Idempotence: `generateObsidianVault(cfg)` called twice produces identical output
- Preservation: files without marker are flagged as `skipped` by sync logic

### Integration tests (`tests/commands/obsidian.test.ts`)

- `arbiter init --yes --obsidian` on TS fixture → vault generated, expected files present
- `arbiter obsidian --sync` on an existing vault → zero diff
- `arbiter obsidian --sync --github-only` → touches only `github/`, leaves `architecture/` alone
- `--dry-run` writes nothing
- Config without `enableObsidianVault` → command errors unless `--force`

### Invariant compliance

- INV-04 (no `any` in TS): generator strict-typed
- INV-06 (no orphan task markers): templates must not contain bare task-marker comments without an issue id

### Viafera POC (manual end-to-end)

1. Build local arbiter: `npm run build`
2. Run `node dist/cli.js obsidian --force --dir /home/luca/work/repos/viafera`
3. Expected detection:
   - backend (Java)
   - frontend (TS)
   - contracts
   - e2e-v2
   - infra
4. Expected generated content:
   - `architecture/modules/` contains one note per detected module
   - `governance/invariants/` populated from arbiter's catalog
   - `github/open-issues.md` reflects current viafera issues (if `gh` auth)
   - `00-INDEX.md` links to all sections
5. Open `docs/vault/` in Obsidian desktop
6. Verify graph view shows ≥3 navigable clusters
7. Verify at least one invariant's `affects-modules` frontmatter is populated

**Outcome artifact:** the generated vault stays in a throwaway branch on viafera as reference material. Not merged.

---

## Milestones

- **M1** — Core generator + templates + unit tests (no GitHub, no modules)
- **M2** — Module detector + module notes + impact-map
- **M3** — Wizard integration + init wiring
- **M4** — `arbiter obsidian` command + sync semantics + idempotence test
- **M5** — GitHub integration + per-issue placeholders
- **M6** — Viafera POC run + manual acceptance

Each milestone produces a commit with passing tests.

---

## Open Questions / Future Work

- **Dataview upgrade path:** frontmatter is compatible, but we do not yet generate `.dataview` query notes. Future `--plugins dataview` flag.
- **Canvas impact maps:** `.canvas` JSON generation deferred until vault is stable.
- **Cross-project vault federation:** a single user with multiple arbiter projects might want a parent vault linking all child vaults. Out of scope for POC.
- **Reverse sync:** edits in the vault flowing back to source (e.g., ADR changes) — explicitly out of scope.
