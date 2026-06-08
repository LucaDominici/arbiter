---
title: 'arbiter Architecture'
doc_version: '1.0.0'
status: active
last_review: '2026-06-08'
owner: ''
canonical_id: 'ARCHITECTURE'
tags: ['audience/dev', 'kind/spine']
related: []
---

# arbiter Architecture

Consolidated architecture reference for arbiter: the system map, the canonical source model, the template pipeline, conflict resolution, the dual-track contract, the evidence-bundle schema, and skeleton governance. Sections below were previously separate files under `docs/architecture/`.

---

## arbiter Architecture

Spine for `docs/architecture/`. Read these in order to understand how arbiter
generates governance scaffolding.

## Reading order

1. [`OVERVIEW.md`](#architecture-overview) — system map: CLI → generators → templates → target project
2. [`CANONICAL-SOURCE-MODEL.md`](#canonical-source-model--deep-dive) — SSOT layering and authority chain
3. [`TEMPLATE-SYSTEM.md`](#template-system) — EJS template pipeline; how `src/templates/*.ejs` becomes target-project artifacts
4. [`CONFLICT-RESOLUTION.md`](#arbiter--conflict-resolution) — merge strategy when re-running `arbiter init` over an existing project
5. [`dual-track-contract.md`](#dual-track-contract) — CANON-16 dual-track rule: changes to self-config must ship with matching template change
6. [`evidence-bundle.md`](#architecture-evidence-bundle-schema-inv-90) — schema for `.arbiter/evidence/*` artifacts
7. [`skeleton-governance.md`](#skeleton-governance-architecture) — what the planning skeleton enforces

## Cross-cutting concepts

| Concept               | Source                                                     |
| --------------------- | ---------------------------------------------------------- |
| Invariants (INV-NN)   | `../../GLOBAL_INVARIANTS.md` + `../../AGENTS.md`           |
| Process rules (CANON) | `../SYSTEM/CANON.md`                                       |
| Decision log (ADR)    | `../ADR/`                                                  |
| Patterns catalog      | `../METHOD/PATTERNS_CATALOG.md` (planned; not yet present) |
| Test taxonomy         | `../TEST_TAXONOMY.md`                                      |
| CI tier model         | `../SYSTEM/CI-TIER-MODEL.md`                               |

## When to file an ADR

A change qualifies as architectural (and needs an ADR under `../ADR/`) when it:

- Adds, removes, or changes a public API surface
- Changes the dual-track contract (CANON-16)
- Changes a governance level threshold (L1/L2/L3)
- Touches the SSOT layering (CANONICAL_PATHS, SSOT_CORE_SET)
- Introduces a new external dependency or runtime requirement
- Reverses or supersedes a previous ADR

---

## Arbiter — Architecture Overview

Arbiter generates a multi-layer governance stack for AI-assisted development. The architecture has one invariant: **a single canonical source of truth**, with all tool-specific configs as thin overlays.

---

## Canonical Source Model

```
AGENTS.md                           <- Layer 0: Canonical governance
|                                      (AAIF standard, read natively by all major AI tools)
|
+-- .claude/CLAUDE.md               <- Layer 1: Claude Code overlay
|   +-- settings.json               |   Hooks wiring, permissions, sub-agent definitions
|   +-- hooks/                      |   PreToolUse/PostToolUse enforcement scripts
|   +-- rules/                      |   Additional rules (lifecycle, exec protocol)
|   +-- commands/                   |   Slash commands (/ship orchestration, /task engine/CLI)
|
+-- .agents/CODEX.md                <- Layer 1: Codex overlay
|   +-- rules/                      |   Mirrored rule set (same content as .claude/rules/)
|   +-- plan/                       |   Task plan artifacts (PLAN.json, CONTEXT_PACK.md)
|
+-- .github/                        <- Layer 2: GitHub integration
|   +-- workflows/ci.yml            |   CI pipeline (parameterized by stack)
|   +-- PULL_REQUEST_TEMPLATE.md    |   Structured PR descriptions
|   +-- ISSUE_TEMPLATE/             |   Bug, feature, task brief templates
|   +-- dependabot.yml              |   Automated dependency updates
|   +-- CODEOWNERS                  |   Review assignment
|
+-- scripts/check-all.mjs           <- Layer 2: Quality gate runner
```

---

## Layer 0 — AGENTS.md (Canonical)

`AGENTS.md` is the single source of truth for:

- **Project identity** — name, stack, build/test commands, gate command
- **Authority hierarchy** — which documents override which
- **Invariants** — non-negotiable rules (architecture, code quality, process)
- **Coding standards** — language-specific conventions
- **Testing policy** — what must be tested and how
- **Commit convention** — type(scope): summary format
- **Branch strategy** — naming, protection rules
- **Gate system** — L1/L2/L3 layered quality checks
- **Multi-agent extensions** — per-tool capability table

### Why AGENTS.md

`AGENTS.md` was co-donated to the [AAIF (Agentic AI Interoperability Foundation)](https://agents.md/) by Anthropic and OpenAI (December 2025) as the universal AI governance standard. It is:

- Natively read by: Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf
- Adopted by 60,000+ projects
- A Linux Foundation standard under the AAIF

Using `AGENTS.md` as canonical means governance is written once and available to every tool, present and future, without tool-specific duplication.

---

## Layer 1 — Tool Overlays (Thin Pointers)

Each tool config opens with an explicit pointer to `AGENTS.md`:

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

### What tool configs add (and only this)

| Tool             | Claude Code                                 | Codex                           |
| ---------------- | ------------------------------------------- | ------------------------------- |
| Auth/Permissions | `settings.json` permissions + allowed tools | —                               |
| Hook wiring      | `settings.json` hooks section               | —                               |
| Hook scripts     | `.claude/hooks/*.mjs`                       | —                               |
| Slash commands   | `.claude/commands/*.md`                     | —                               |
| Sub-agents       | `.claude/agents/*.md`                       | —                               |
| Plan schema      | —                                           | `CODEX.md` §Plan Schema         |
| Exec router      | —                                           | `CODEX.md` §Execution Router    |
| Context pack     | —                                           | `.agents/plan/CONTEXT_PACK.md`  |
| Rule mirror      | `.claude/rules/`                            | `.agents/rules/` (same content) |

### What tool configs must NOT contain

- Invariants (those live in `AGENTS.md`)
- Coding standards (those live in `AGENTS.md`)
- Commit conventions (those live in `AGENTS.md`)
- Testing policy (those live in `AGENTS.md`)
- Authority hierarchy (lives in `AGENTS.md`)

Anything duplicated between `AGENTS.md` and a tool config will drift.

---

## Layer 2 — GitHub + Quality Gates

### CI Workflow

Generated at `.github/workflows/ci.yml`, parameterized by detected stack:

- TypeScript: `npm ci -> typecheck -> lint -> test --coverage`
- Java: `gradlew checkstyleMain -> gradlew test`
- Rust: `cargo fmt --check -> cargo clippy -> cargo test`
- Go: `gofmt -> golangci-lint -> go test`
- Python: `ruff check -> ruff format -> pytest`

Always includes a `ci-required` job as the merge gate (required status check for branch protection).

### Quality Gate Script (`scripts/check-all.mjs`)

Three-level gate system:

| Level | Checks                              | When                  |
| ----- | ----------------------------------- | --------------------- |
| L1    | Format + lint + unit tests          | Pre-commit (fast)     |
| L2    | L1 + integration + coverage + audit | Pre-push (matches CI) |
| L3    | L2 + E2E + evidence                 | Release / audit       |

```bash
node scripts/check-all.mjs L1   # fast local check
node scripts/check-all.mjs L2   # full gate (default)
node scripts/check-all.mjs       # defaults to L2
```

### Labels

14 standard labels provisioned via `gh label create/edit`:

- **Type:** `bug`, `feature`, `task`, `docs`, `refactor`, `test`, `ci`, `deps`
- **Task size:** `size:XS`, `size:S`, `size:Standard` (colon convention — #237)
- **Priority:** `priority/P0`, `priority/P1`, `priority/P2`

### Branch Protection

Applied to `main` via `gh api`:

- Required status check: `CI Required`
- Required review: 1 approving reviewer
- Dismiss stale reviews on push
- No force-push, no deletions

---

## Extensibility

### Phases 3-4: Update + Diff & Additional Targets (DONE)

Phases 3 and 4 are complete and shipped:

- **Phase 3** — `arbiter update` and `arbiter diff` commands with `arbiter.json` config persistence
- **Phase 4** — Additional tool targets (Cursor `.cursorrules`, Copilot `.github/copilot-instructions.md`)

See [CLI Reference](../REFERENCE/CLI.md) for command documentation.

### Additional Tool Targets

| Tool       | File                              | Status              |
| ---------- | --------------------------------- | ------------------- |
| Cursor     | `.cursorrules`                    | Shipped             |
| Copilot    | `.github/copilot-instructions.md` | Shipped             |
| Gemini CLI | `GEMINI.md`                       | Planned (Phase 6-8) |
| Windsurf   | `.windsurfrules`                  | Planned (Phase 6-8) |

All targets follow the same thin-pointer pattern: point to `AGENTS.md`, add only tool-specific configuration.

### Phases 6-8: Future Work

- Gemini CLI and Windsurf overlay generation
- Plugin / extension API for community-contributed tool targets
- Template customization and inheritance

---

## Canonical Source Model — Deep Dive

Arbiter's invariant: one canonical governance file, all tool configs as thin overlays. This document explains the model in full, why it exists, and how the write pipeline enforces it at generation time.

For the layer diagram and quick summary, see [OVERVIEW.md](#architecture-overview). For the ADR rationale, see [ADR-001](../ADR/001-agents-md-canonical.md) and [ADR-002](../ADR/002-thin-pointer-pattern.md).

---

## Why AGENTS.md Is Canonical

`AGENTS.md` was co-donated to the [AAIF (Agentic AI Interoperability Foundation)](https://agents.md/) by Anthropic and OpenAI in December 2025. It is a Linux Foundation standard, not a proprietary format. As of early 2026:

- **Universal native reading** — Claude Code, Codex, Cursor, Copilot, Gemini CLI, and Windsurf all read `AGENTS.md` without configuration.
- **Single maintenance point** — a governance change written once in `AGENTS.md` propagates to every tool automatically.
- **No vendor lock-in** — the file format belongs to the AAIF, not to any AI tool vendor.
- **Adopted at scale** — 60,000+ projects use the standard.

The alternative — maintaining governance in each tool's native format — guarantees drift. Tool configs each add their own syntax and semantics; keeping them consistent manually is unsustainable.

---

## Layer Model

```
Layer 0   AGENTS.md                         <- Canonical governance (AAIF standard)
             |
Layer 1   .claude/CLAUDE.md                 <- Claude Code overlay (thin pointer)
          .claude/settings.json             <- Hook wiring + permissions (deep-merged)
          .claude/hooks/*.mjs                <- Enforcement scripts (skipIfExists)
          .claude/rules/*.md                <- Rule documents (skipIfExists)
          .claude/commands/*.md             <- Slash commands (skipIfExists)
             |
          .agents/CODEX.md                  <- Codex overlay (thin pointer)
          .agents/rules/                    <- Rule mirror (skipIfExists)
          .agents/plan/                     <- Task plan artifacts (skipIfExists)
             |
Layer 2   .github/workflows/ci.yml          <- CI pipeline (skipIfExists)
          .github/PULL_REQUEST_TEMPLATE.md  <- PR template (skipIfExists)
          .github/ISSUE_TEMPLATE/           <- Issue templates (skipIfExists)
          .github/dependabot.yml            <- Dep updates (skipIfExists)
          scripts/check-all.mjs              <- Gate runner (skipIfExists)
          CODEOWNERS                        <- Review ownership (skipIfExists)
          SECURITY.md                       <- Vulnerability policy (skipIfExists)
          CONTRIBUTING.md                   <- Contribution guide (skipIfExists)
          .editorconfig                     <- Editor defaults (skipIfExists)
```

Each layer has a distinct role and write strategy. Mixing them — for example, putting invariants in `CLAUDE.md` or coding standards in a hook — creates drift.

---

## What Belongs Where

### Layer 0: AGENTS.md (Canonical — backup + replace)

Everything that must be consistent across all AI tools:

| Concern                | Example                                       |
| ---------------------- | --------------------------------------------- |
| Project identity       | name, stack, build/test commands              |
| Authority hierarchy    | which document overrides which                |
| Invariants             | non-negotiable architecture and process rules |
| Coding standards       | language-specific conventions                 |
| Testing policy         | what must be tested and how                   |
| Commit convention      | `type(scope): summary` format                 |
| Branch strategy        | naming, protection rules                      |
| Gate system            | L1/L2/L3 quality levels                       |
| Multi-agent extensions | per-tool capability table                     |

`AGENTS.md` is stateless (fully regenerated from `ProjectConfig`). A backup is kept on re-init (`AGENTS.md.arbiter-backup`) but the file is always replaced. See [ADR-001](../ADR/001-agents-md-canonical.md).

### Layer 1: Tool Overlays (thin pointer — backup + replace for `CLAUDE.md`/`CODEX.md`, deep merge for `settings.json`, skipIfExists for everything else)

Tool overlays **add** what `AGENTS.md` cannot express natively for a specific tool. They must **not** duplicate any content already in `AGENTS.md`.

**What tool configs add (and only this):**

| Concern               | Claude Code                                    | Codex                          |
| --------------------- | ---------------------------------------------- | ------------------------------ |
| Permissions schema    | `settings.json` `permissions` + `allowedTools` | —                              |
| Hook wiring           | `settings.json` `hooks` section                | —                              |
| Enforcement scripts   | `.claude/hooks/*.mjs`                          | —                              |
| Slash commands        | `.claude/commands/*.md`                        | —                              |
| Sub-agent definitions | `.claude/agents/*.md`                          | —                              |
| Plan schema           | —                                              | `CODEX.md` §Plan Schema        |
| Execution router      | —                                              | `CODEX.md` §Execution Router   |
| Context pack          | —                                              | `.agents/plan/CONTEXT_PACK.md` |
| Rule mirror           | `.claude/rules/`                               | `.agents/rules/`               |

**What tool configs must not contain:**

- Invariants (those live in `AGENTS.md`)
- Coding standards (those live in `AGENTS.md`)
- Commit conventions (those live in `AGENTS.md`)
- Testing policy (those live in `AGENTS.md`)
- Authority hierarchy (lives in `AGENTS.md`)

Any content duplicated between `AGENTS.md` and a tool config will drift the moment one is updated without the other.

### Layer 2: GitHub + Infrastructure (skipIfExists)

GitHub files, the CI workflow, and infrastructure files (`CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `.editorconfig`) are generated once and never overwritten. They are intended for project-specific customization immediately after generation. See [ADR-004](../ADR/004-skip-if-exists.md).

---

## Write Pipeline and Drift Prevention

The generation pipeline enforces the layer model through two mechanisms:

### 1. Write Strategy Per File

`src/utils/fs.ts` exposes `writeFile(path, content, opts)` with:

- `{ backup: true }` — write a `.arbiter-backup` copy of the existing file, then replace. Used for `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`.
- `{ skipIfExists: true }` — do nothing if the file exists. Used for hooks, rules, commands, GitHub files, `scripts/check-all.mjs`.
- `mergeSettingsJson()` — deep merge for `settings.json`: hooks union by matcher+command, permissions union arrays, other keys keep existing value.

Each call returns a `WriteResult` with `action: 'created' | 'skipped' | 'backed-up-and-replaced'`. The init command prints a summary of all results, making the effect of each run visible.

All writes use an **atomic rename pattern** internally: content is written to a sibling temp file (`<path>.arbiter-tmp-<hex>`) and then renamed into place. SIGTERM and SIGINT handlers registered at CLI startup clean up any in-flight temp files on signal receipt, ensuring no `.arbiter-tmp-*` orphans are left on interrupted runs.

### 2. ai-rulez Coexistence Gate

If the target project already uses [ai-rulez](https://github.com/isobar-ai/ai-rulez) (detected by presence of `.ai-rulez/` or `ai-rulez.yml`), the init flow skips tool config generation entirely. `AGENTS.md` and GitHub files are still generated. This prevents arbiter from overwriting an existing, project-owned tool configuration strategy. See [ADR-010](../ADR/010-ai-rulez-coexistence.md).

### 3. Config + Snapshot Write Pair

`saveConfigAndSnapshot(dir, config)` in `src/utils/config.ts` serializes the config to JSON once, then writes both `arbiter.json` and `.arbiter-generated.json` using `writeFile`. Pre-serializing before any write means a JSON failure leaves neither file touched; since both writes use the same string, they are always consistent in content. This replaced the prior sequential `saveConfig` + `saveSnapshot` pattern where an ENOSPC error between the two writes left the project in an inconsistent state (#772).

### 4. Stateless Canonical, Stateful Customizable

The core asymmetry: canonical files (`AGENTS.md`, thin pointers) are stateless — they contain no project-specific customization. They are safe to regenerate. Customizable files (hooks, rules, commands) are stateful from the moment a team modifies them. The `skipIfExists` strategy respects that boundary. See [ADR-011](../ADR/011-brownfield-first-design.md) for the brownfield design rationale.

---

## Thin Pointer Pattern

Every Layer 1 tool config opens with an explicit pointer to `AGENTS.md`:

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

This opening block is non-negotiable. It:

1. Tells the AI tool where the authoritative rules live.
2. Makes the layering visible to any human reading the file.
3. Prevents the tool config from being extended with governance content.

The generated `CLAUDE.md` and `CODEX.md` templates enforce this pattern. See [ADR-002](../ADR/002-thin-pointer-pattern.md) for the full rationale and the rejected alternatives.

---

## Template System

Arbiter generates all output files from templates. This document covers why EJS was chosen, the full `ProjectConfig` variable reference available in templates, conditional branching patterns, the `renderTemplate()` pipeline, and a complete inventory of the 32 template files.

For the ADR rationale, see [ADR-009](../ADR/009-ejs-over-handlebars.md).

---

## Why EJS

EJS (Embedded JavaScript) was chosen over Handlebars, Mustache, and Nunjucks for three reasons:

1. **JavaScript interpolation with no new syntax** — template authors use plain JS expressions (`<% if (...) %>`, `<%= variable %>`), not a custom DSL. Anyone who knows JavaScript can read and modify templates without learning another language.
2. **Already in use** — all 32 template files use `.ejs` syntax. There is no migration cost.
3. **Simple rendering API** — `ejs.render(templateString, data)` is a single function call. The rendering pipeline in `src/utils/render.ts` is 20 lines.

See [ADR-009](../ADR/009-ejs-over-handlebars.md) for alternatives considered.

---

## Rendering Pipeline

**`renderTemplate(templatePath, config)`** in `src/utils/render.ts`:

1. Resolves the template path relative to the `src/templates/` directory.
2. Reads the file synchronously with `fs.readFileSync`.
3. Calls `ejs.render(content, config)` with the full `ProjectConfig` as data.
4. Returns the rendered string.

**`renderString(templateString, config)`**: same as above but takes an inline EJS string instead of a file path. Used for short inline snippets (e.g., generating a single line of a config file).

Templates are plain files. If a file in `src/templates/` contains no EJS tags, it is copied verbatim (the `ejs.render` call is a no-op on static content). This means static and dynamic templates coexist in the same directory without special handling.

---

## ProjectConfig Variable Reference

Every template has access to the full `ProjectConfig` object. All fields are available as top-level variables inside EJS tags.

```typescript
interface ProjectConfig {
  // Core identity
  targetDir: string // Absolute path to the project being initialized
  projectName: string // Human-readable project name
  description: string // One-line project description

  // Stack
  language: 'typescript' | 'java' | 'rust' | 'go' | 'python' | 'unknown'
  framework: string // e.g. 'next', 'vue', 'react', 'express', 'spring-boot', 'quarkus', 'tauri', ''
  buildTool: string // e.g. 'npm', 'gradle', 'cargo', 'go', 'pip', ''

  // Commands (auto-detected or wizard-provided)
  buildCommand: string // e.g. 'npm run build'
  testCommand: string // e.g. 'npm test'
  lintCommand: string // e.g. 'npm run lint'
  formatCommand: string // e.g. 'npm run format'

  // Tool selection
  tools: Array<'claude' | 'codex' | 'cursor' | 'copilot'>

  // Governance
  governanceLevel: 'L1' | 'L2' | 'L3'

  // GitHub integration
  useGitHub: boolean
  githubOwner: string // GitHub username or org, '' if not available
  githubRepo: string // Repository name, '' if not available

  // Existing state (detected before generation)
  existing: {
    agentsMd: boolean // AGENTS.md present in targetDir
    claudeDir: boolean // .claude/ directory present
    agentsDir: boolean // .agents/ directory present
    aiRulez: boolean // .ai-rulez/ or ai-rulez.yml present
    settingsJson: boolean // .claude/settings.json present
    checkAllScript: boolean // scripts/check-all script present
  }

  // Language-specific hooks
  languageHooks: LanguageHook[]
}

interface LanguageHook {
  name: string // Hook display name
  matcher: string // File glob pattern for PreToolUse trigger
  command: string // Shell command to run
}
```

### Common Template Patterns

**Language conditional:**

```ejs
<% if (language === 'typescript') { %>
- Run `npm run typecheck` before committing.
<% } else if (language === 'java') { %>
- Run `./gradlew checkstyleMain` before committing.
<% } %>
```

**Tools loop:**

```ejs
<% tools.forEach(tool => { %>
- <%= tool %> overlay generated at generation time.
<% }) %>
```

**Framework-specific content:**

```ejs
<% if (framework === 'next') { %>
### Next.js Conventions
...
<% } else if (framework === 'vue') { %>
### Vue 3 Conventions
...
<% } %>
```

**Governance level gating:**

```ejs
<% if (governanceLevel === 'L3') { %>
## Audit Evidence

L3 gate requires evidence artifacts in `.evidence/` before release.
<% } %>
```

**Conditional GitHub section:**

```ejs
<% if (useGitHub && githubOwner) { %>
**Repository:** https://github.com/<%= githubOwner %>/<%= githubRepo %>
<% } %>
```

---

## Template Inventory

32 template files across 8 subdirectories in `src/templates/`:

### `agents-md/` (1 file)

| File            | Output      | Type    |
| --------------- | ----------- | ------- |
| `agents.md.ejs` | `AGENTS.md` | Dynamic |

### `claude/` (multiple files)

| File                          | Output                            | Type    |
| ----------------------------- | --------------------------------- | ------- |
| `claude-md.ejs`               | `.claude/CLAUDE.md`               | Dynamic |
| `settings.json.ejs`           | `.claude/settings.json` (initial) | Dynamic |
| `hooks/pre-tool-use.mjs.ejs`  | `.claude/hooks/pre-tool-use.mjs`  | Dynamic |
| `hooks/post-tool-use.mjs.ejs` | `.claude/hooks/post-tool-use.mjs` | Dynamic |
| `rules/exec-protocol.md`      | `.claude/rules/exec-protocol.md`  | Static  |
| `commands/task.md`            | `.claude/commands/task.md`        | Static  |

### `codex/` (multiple files)

| File                     | Output                           | Type    |
| ------------------------ | -------------------------------- | ------- |
| `codex-md.ejs`           | `.agents/CODEX.md`               | Dynamic |
| `rules/exec-protocol.md` | `.agents/rules/exec-protocol.md` | Static  |
| `plan/PLAN.json`         | `.agents/plan/PLAN.json`         | Static  |
| `plan/CONTEXT_PACK.md`   | `.agents/plan/CONTEXT_PACK.md`   | Static  |

### `cursor/` (1 file)

| File              | Output         | Type    |
| ----------------- | -------------- | ------- |
| `cursorrules.ejs` | `.cursorrules` | Dynamic |

### `copilot/` (1 file)

| File                          | Output                            | Type    |
| ----------------------------- | --------------------------------- | ------- |
| `copilot-instructions.md.ejs` | `.github/copilot-instructions.md` | Dynamic |

### `github/` (multiple files)

| File                         | Output                               | Type    |
| ---------------------------- | ------------------------------------ | ------- |
| `workflows/ci.yml.ejs`       | `.github/workflows/ci.yml`           | Dynamic |
| `PULL_REQUEST_TEMPLATE.md`   | `.github/PULL_REQUEST_TEMPLATE.md`   | Static  |
| `ISSUE_TEMPLATE/bug.yml`     | `.github/ISSUE_TEMPLATE/bug.yml`     | Static  |
| `ISSUE_TEMPLATE/feature.yml` | `.github/ISSUE_TEMPLATE/feature.yml` | Static  |
| `ISSUE_TEMPLATE/task.yml`    | `.github/ISSUE_TEMPLATE/task.yml`    | Static  |
| `dependabot.yml.ejs`         | `.github/dependabot.yml`             | Dynamic |

### `root/` (multiple files)

| File              | Output            | Type    |
| ----------------- | ----------------- | ------- |
| `CODEOWNERS.ejs`  | `CODEOWNERS`      | Dynamic |
| `SECURITY.md`     | `SECURITY.md`     | Static  |
| `CONTRIBUTING.md` | `CONTRIBUTING.md` | Static  |
| `.editorconfig`   | `.editorconfig`   | Static  |

### `check-all/` (1 file)

| File                | Output                  | Type    |
| ------------------- | ----------------------- | ------- |
| `check-all.mjs.ejs` | `scripts/check-all.mjs` | Dynamic |

---

## Adding a Template

1. Create the file in the appropriate subdirectory of `src/templates/`. Use `.ejs` extension if the file needs any `ProjectConfig` variables; omit it for fully static content.
2. In the relevant generator (`src/generators/`), call `renderTemplate('subdir/filename.ejs', config)` to get the rendered string.
3. Call `writeFile(outputPath, rendered, opts)` with the appropriate write strategy (`skipIfExists` or `backup`).
4. Add a test in `__tests__/` that verifies the file is generated with correct content for at least one `ProjectConfig` variant.

See [GETTING-STARTED.md](../DEVELOPMENT/GETTING-STARTED.md) for the full walkthrough with examples.

---

## Arbiter — Conflict Resolution

How arbiter handles existing files, merges configuration, and ensures idempotent operation.

---

## Conflict Resolution Strategy

| File                               | Strategy                         | Reason                           |
| ---------------------------------- | -------------------------------- | -------------------------------- |
| `AGENTS.md`                        | Backup + replace                 | Always regenerated from template |
| `.claude/CLAUDE.md`                | Backup + replace                 | Thin pointer — stateless         |
| `.agents/CODEX.md`                 | Backup + replace                 | Thin pointer — stateless         |
| `.claude/settings.json`            | Deep merge                       | Custom hooks must be preserved   |
| `.claude/hooks/*.mjs`              | Skip if exists                   | Project-customized               |
| `.claude/rules/*.md`               | Skip if exists                   | Project-customized               |
| `.claude/commands/*.md`            | Skip if exists                   | Project-customized               |
| `.github/workflows/ci.yml`         | Skip if exists                   | May be heavily customized        |
| `.github/PULL_REQUEST_TEMPLATE.md` | Skip if exists                   | May be customized                |
| `.github/ISSUE_TEMPLATE/*`         | Skip if exists                   | May be customized                |
| `scripts/check-all.mjs`            | Skip if exists                   | May be customized                |
| `SECURITY.md`, `.editorconfig`     | Skip if exists                   | Created once                     |
| GitHub labels                      | Create missing + update existing | Idempotent provisioning          |
| Branch protection                  | Always apply                     | Rules are deterministic          |

---

## settings.json Deep Merge

When `.claude/settings.json` already exists, arbiter deep-merges:

- `permissions.allow` — union of arrays, deduplicated by command
- `permissions.deny` — union of arrays, deduplicated by command
- `hooks` — incoming hooks added if their `matcher` isn't already present
- All other keys — incoming wins

This preserves project-specific hook registrations while adding missing ones.

---

## ai-rulez Detection

If `.ai-rulez/` or `ai-rulez.yml` is present, arbiter detects it and skips multi-tool config generation (the other tool handles it). GitHub and quality gate generation still proceed.

---

## Idempotency Guarantees

**Running `arbiter init` twice is safe** — idempotent by design.

- Canonical files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) are backed up before replacement
- Customizable files (hooks, rules, commands, workflows) are never overwritten
- `settings.json` is deep-merged, preserving existing configuration
- GitHub labels use create-or-update semantics (never deleted)
- Branch protection rules are deterministic and re-applicable

This means arbiter can be run repeatedly — after upgrades, after template changes, or in CI — without destroying project customizations.

---

## Dual-Track Contract

> Every framework capability ships two tracks simultaneously.
> Neither track alone is acceptable.
> Violations block PR merge via `pre-edit-plan-anchor.mjs` + CANON enforcement.

---

## The Contract

For every new engineering skeleton capability added to arbiter:

**Track A — arbiter-for-itself**
The capability is applied to the arbiter repository directly.
Arbiter eats its own cooking.

**Track B — arbiter-as-framework**
The same capability is encoded once-and-for-all as reusable framework artifacts.
Any project that runs `arbiter init` inherits the equivalent capability without copy-paste.

Both tracks ship in the **same PR** on the **same branch**. Split PRs are a violation.

---

## Track B Sub-Tracks

Track B has four sub-tracks. Not all four are required for every capability — the wave matrix specifies which apply.

| Sub-track | What it is                                                                     | Required when                                         |
| --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **B1**    | EJS template under `src/templates/`                                            | Capability produces a generated file                  |
| **B2**    | Generator under `src/generators/*.ts`                                          | B1 template needs rendering logic or parameterization |
| **B3**    | KIT reference doc under `docs/REFERENCE/`                                      | Capability maps to ≥1 KIT dim                         |
| **B4**    | Invariant or gate entry in `src/invariants/catalog.ts` or `src/kit/catalog.ts` | Capability has a machine-enforceable contract         |

If a capability is docs-only (no template, no gate), B1/B2/B4 may be omitted — but B3 is always required.

---

## Wave Matrix Template

Every wave in `docs/plans/planning-skeleton-migration-plan.md` fills in this table:

| Deliverable           | Track A path            | B1 template path                          | B2 generator                              | B3 doc path                    | B4 catalog entry |
| --------------------- | ----------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------ | ---------------- |
| (example) gate script | `scripts/check-foo.mjs` | `src/templates/scripts/check-foo.mjs.ejs` | `src/generators/anti-drift-validators.ts` | `docs/REFERENCE/dim-NN-foo.md` | INV-NN           |
| (fill per wave)       |                         |                                           |                                           |                                |                  |

---

## Canonical Examples

### Example: Local Wrapper (W3)

| Track | Deliverable                                                      |
| ----- | ---------------------------------------------------------------- |
| A     | `Makefile` + `run.sh` in arbiter root                            |
| A     | `scripts/check-local-ci-parity.mjs` (verifies Makefile↔CI drift) |
| B1    | `src/templates/local-wrapper/Makefile.ejs`                       |
| B1    | `src/templates/local-wrapper/run.sh.ejs`                         |
| B2    | `src/generators/local-wrapper.ts`                                |
| B3    | `docs/REFERENCE/local-wrapper-contract.md`                       |
| B4    | INV-87 in `src/invariants/catalog.ts`                            |

### Example: CI Tier Baseline (W4)

| Track | Deliverable                                             |
| ----- | ------------------------------------------------------- |
| A     | `.github/workflows/01-pr-fast.yml`                      |
| A     | `.github/workflows/02-pr-extended.yml`                  |
| B1    | `src/templates/github/workflows/01-pr-fast.yml.ejs`     |
| B1    | `src/templates/github/workflows/02-pr-extended.yml.ejs` |
| B2    | `src/generators/github-workflows.ts` (extend)           |
| B3    | `docs/REFERENCE/ci-tier-workflows.md`                   |
| B4    | INV-73 status update in catalog                         |

### Example: KIT Canonical SSOT (W2)

| Track | Deliverable                                             |
| ----- | ------------------------------------------------------- |
| A     | `src/kit/{taxonomy,catalog,index}.ts`                   |
| A     | `scripts/check-kit-catalog-parity.mjs`                  |
| B1    | `src/templates/kit/*.ejs`                               |
| B2    | `src/generators/kit.ts`                                 |
| B3    | `docs/REFERENCE/dim-001-*.md … dim-076-*.md` (76 files) |
| B4    | INV-86 in catalog                                       |

### Example: Anti-Drift Validator (W6)

| Track | Deliverable                                                           |
| ----- | --------------------------------------------------------------------- |
| A     | `scripts/check-workflow-sha-pinning.mjs`                              |
| B1    | `src/templates/scripts/anti-drift/check-workflow-sha-pinning.mjs.ejs` |
| B2    | `src/generators/anti-drift-validators.ts`                             |
| B3    | `docs/REFERENCE/anti-drift-family.md`                                 |
| B4    | INV-89 (every validator must support `--help`)                        |

---

## Enforcement Mechanisms

| Mechanism                       | What it catches                                                           | CANON rule                              |
| ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `pre-edit-plan-anchor.mjs` hook | Edit attempted without plan-anchor commit during IMPL phases              | CANON-14                                |
| `check-no-orphan-todo.mjs` hook | Half-finished B-track with `TODO(#NNN)` missing from plan                 | CANON-09                                |
| `post-edit-dispatch.mjs` hook   | Format + lint after any file edit; catches B-track template regressions   | CANON-04                                |
| CANON-04                        | New/edited EJS template without dual-track check in plan                  | `.claude/rules/30-canon-enforcement.md` |
| CANON-05                        | New/edited generator without template counterpart                         | `.claude/rules/30-canon-enforcement.md` |
| CANON-11                        | Generator that writes files without a template                            | `.claude/rules/30-canon-enforcement.md` |
| Gate (INV-86)                   | Kit catalog dims with BLOCKING gate_type but no B4 invariant or validator | `scripts/check-kit-catalog-parity.mjs`  |

---

## Anti-Patterns

| Anti-pattern                                                   | Why it violates the contract                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "I'll add the template later"                                  | B1 deferred = Track B incomplete = violation on merge                     |
| "The arbiter-self version is enough"                           | Framework consumers get nothing; defeats arbiter's mission                |
| "The template is enough; I won't apply it to arbiter's own CI" | Track A incomplete; arbiter cannot dogfood its own patterns               |
| Split PRs (A in one PR, B in another)                          | Invariants in A reference templates in B that don't exist yet; gate fails |
| B3-only (docs without enforcement)                             | Acceptable only for `REFERENCE` gate-type dims; BLOCKING dims need B4     |

---

## Scope Boundaries

The dual-track contract applies to:

- Gate scripts (any `scripts/check-*.mjs` that is part of the skeleton harness)
- CI workflows (any `.github/workflows/*.yml`)
- Local wrapper targets (Makefile, run.sh)
- Stack adapter capabilities (any `src/adapters/*.ts` method that emits harness artifacts)
- KIT catalog dims with `arbiter_target_kind` ≠ `adapter`

The dual-track contract does NOT apply to:

- Arbiter-internal TypeScript modules with no framework output (e.g., `src/detectors/*.ts`)
- One-off scripts under `scripts/` that are exclusively for arbiter's own repo management
- ADRs and decision logs (docs-only, no framework output needed)
- Test fixtures under `__tests__/` (not emitted to target projects)

---

## References

- `#skeleton-governance-architecture (this document)` — primitive taxonomy and architecture Q&A
- `docs/plans/planning-skeleton-migration-plan.md` — wave-by-wave dual-track matrix
- `AGENTS.md §Invariants` — INV-73, INV-86..INV-93
- `.claude/rules/30-canon-enforcement.md` — CANON-04/05/07/11/13/14/15

---

## Architecture: Evidence Bundle Schema (INV-90)

## Overview

An **evidence bundle** is a JSON file stored at `.evidence/task-NNN/bundle.json` that records
the TDD lifecycle artifacts for a completed task. The schema is defined at
`schemas/evidence-bundle.schema.json` (JSON Schema v7) and enforced by INV-90 via
`scripts/check-evidence-bundle.mjs` at the L2 gate.

## Purpose

Evidence bundles provide an auditable trail for every task:

1. **TDD compliance** — records that red-phase (failing) tests existed before implementation
2. **Gate result capture** — snapshots the quality gate result at time of completion
3. **Artifact traceability** — links to test output, coverage reports, or other evidence files

## Schema

File: `schemas/evidence-bundle.schema.json`

| Field           | Type                 | Required | Description                               |
| --------------- | -------------------- | -------- | ----------------------------------------- |
| `taskId`        | string               | yes      | GitHub issue reference, e.g. `#883`       |
| `timestamp`     | string (ISO 8601)    | yes      | When the bundle was recorded              |
| `gateResult`    | `"pass"` or `"fail"` | yes      | Quality gate result at completion         |
| `redTestPath`   | string               | yes      | Path to failing test written in red phase |
| `greenTestPath` | string               | yes      | Path to passing test after implementation |
| `artifacts`     | Artifact[]           | yes      | Additional artifacts (may be empty array) |

### Artifact object

| Field      | Type   | Required | Description                   |
| ---------- | ------ | -------- | ----------------------------- |
| `name`     | string | yes      | Human-readable name           |
| `path`     | string | yes      | Relative path from repo root  |
| `mimeType` | string | no       | MIME type (e.g. `text/plain`) |

## Directory Structure

```
.evidence/
  task-#883/
    bundle.json          ← evidence bundle (validated by INV-90)
    test-output.txt      ← optional artifact
  task-#884/
    bundle.json
```

## Enforcement

The `check-evidence-bundle.mjs` script is wired at the L2 gate (`gate` subcommand) in
`scripts/check-all.mjs`. It:

1. Scans `.evidence/task-*/` for `*.json` files
2. Validates each against `schemas/evidence-bundle.schema.json`
3. Exits 0 if no bundles are found (vacuous pass — new projects have no evidence)
4. Exits 1 if any bundle fails validation

## Lifecycle

Evidence bundles are created by `arbiter task record-red` and written to
`.arbiter/evidence/tdd/#NNN.json`. The `.evidence/task-NNN/bundle.json` format
is the published, schema-validated form intended for external audit consumption.

Bundles accumulate over the project lifetime and are never deleted (append-only
audit trail, see INV-83 when implemented).

## Related

- `docs/TEST_TAXONOMY.md` — 25-dimension test taxonomy
- `docs/REFERENCE/evidence-schema.md` — schema reference for target projects
- `scripts/check-tdd-evidence.mjs` — TDD evidence per-commit check (separate concern)
- `src/invariants/catalog.ts` — INV-90 entry
- `AGENTS.md` — INV-90 declaration

---

## Skeleton Governance Architecture

> Single SSOT defining the target architecture for arbiter's engineering skeleton harness.
> Every primitive used across W2-W11 is named here.
> Downstream: `#dual-track-contract (this document)`, `docs/audits/arbiter-skeleton-gap-analysis.md`.

---

## Primitive Taxonomy

### HarnessCategory (16-enum)

Every artifact in the engineering skeleton belongs to exactly one category.

| Value                   | Description                                                         | Arbiter Primitive                                                   |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `local-command-harness` | Developer-facing entrypoint scripts and Makefile/run.sh façade      | `Makefile`, `run.sh`, `scripts/check-all.mjs`                       |
| `ci-workflow`           | GitHub Actions workflow files (.github/workflows/\*.yml)            | `.github/workflows/*.yml` + EJS templates                           |
| `parity-mechanism`      | Contracts verifying local command output ↔ CI job output            | `scripts/check-local-ci-parity.mjs` + INV-87                        |
| `test-harness`          | Test taxonomy, test runners, test types, evidence schema            | `docs/TEST_TAXONOMY.md`, `schemas/evidence-bundle.schema.json`      |
| `contract-verification` | API schema, pact, OpenAPI, Newman contract tests                    | `src/templates/contract/` (framework only)                          |
| `static-analysis`       | Lint, format, type-check, dead code, architectural rule enforcement | `scripts/check-*.mjs` (agnostic) + stack adapter (stack-specific)   |
| `supply-chain-check`    | Signing, SBOM, Trivy, OWASP dependency check, secret scanning       | `.github/workflows/05-release.yml`, `scripts/check-secret-scan.mjs` |
| `evidence-capture`      | Commands + outputs captured in machine-readable bundles             | `.evidence/*/`, `scripts/evidence-*.mjs`                            |
| `docs-governance`       | Docs that are required by protocol (AGENTS.md, ADRs, runbooks)      | `AGENTS.md`, `docs/ADR/`, `docs/SYSTEM/`                            |
| `agent-instruction`     | Directives for AI agents (AGENTS.md, .claude/agents/\*.md)          | `.claude/agents/*.md`, `AGENTS.md`                                  |
| `agent-command`         | Claude Code slash commands (.claude/commands/\*.md)                 | `.claude/commands/*.md`                                             |
| `hook`                  | Pre/post edit/bash hooks and git hooks                              | `.claude/hooks/*.mjs`, `.githooks/`                                 |
| `bootstrap`             | Repo initialization scripts (setup-repo.sh, arbiter init)           | `scripts/setup-repo.sh`, `src/commands/init.ts`                     |
| `release`               | Release workflow, signing, artifact publishing                      | `.github/workflows/05-release.yml`, `sign-and-attest` action        |
| `issue-governance`      | Label sync, PR template, PR staleness, notify workflows             | `.github/labels.yml`, `.github/workflows/_*.yml`                    |
| `anti-drift-validator`  | Scripts checking that repo state matches declared contracts         | `scripts/check-*.mjs` (drift family)                                |

---

### GateType (6-enum)

Every KIT dimension has exactly one gate type governing when and how failure is reported.

| Value               | Meaning                                                                              | When enforced                       |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| `BLOCKING`          | Fails the gate; merge blocked until resolved                                         | Every PR (L1 + L2 gate)             |
| `BLOCKING(nightly)` | Fails nightly run; creates `nightly-down` issue                                      | Nightly workflow (`06-nightly.yml`) |
| `BLOCKING(locale)`  | Required in generated project's local wrapper (Makefile target or run.sh subcommand) | `make gate` / `./run.sh gate`       |
| `BLOCKING(pharma)`  | Required for pharma-regulated profiles; skipped otherwise                            | Stack adapter pharma conditional    |
| `ADVISORY`          | Warning reported; merge allowed                                                      | L2 gate (informational)             |
| `REFERENCE`         | Documentation only; no machine enforcement                                           | Docs + framework template only      |

**Gate depth allocation:**

| Gate       | Tier | Contents                                          |
| ---------- | ---- | ------------------------------------------------- |
| L1 fast    | T1   | All BLOCKING dims with runtime < 30s each         |
| L2 full    | T2   | All BLOCKING + BLOCKING(locale) + ADVISORY dims   |
| Nightly    | T3   | BLOCKING(nightly) dims + slow supply chain checks |
| Local fast | T0   | Subset of T1 (pre-commit hook; ≤10 dims)          |

---

### MaturityTier (3-level)

| Value | Alias in XLSX | Meaning                                 | When required                       |
| ----- | ------------- | --------------------------------------- | ----------------------------------- |
| `M1`  | `L1`          | Baseline — any production project       | Default tier; always generated      |
| `M2`  | `L2`          | Intermediate — regulated or high-stakes | `governanceLevel >= 2` in generator |
| `M3`  | `L3`          | Advanced — pharma / high-assurance      | `governanceLevel == 3` in generator |

**TML alias note:** The KIT XLSX uses L1/L2/L3. Arbiter canonical is M1/M2/M3 to avoid collision with the T1/T2/T3 gate-depth tier. ADR-045 records this alias.

---

### StackTag (8-enum)

| Value         | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `agnostic`    | Applies to all stacks; emitted by core framework       |
| `java_spring` | Java + Spring Boot; emitted by Java stack adapter (F2) |
| `node_ts`     | Node.js + TypeScript; emitted by TS adapter (W5)       |
| `python`      | Python; stub adapter (F2-python)                       |
| `go`          | Go; stub adapter (F2-go)                               |
| `rust`        | Rust; stub adapter (F2-rust)                           |
| `mixed`       | Cross-stack (e.g., GitHub Actions calling any runtime) |
| `template`    | Framework template only; no arbiter-self enforcement   |

---

### EvidenceArtifact

Every CI run and local gate produces an evidence artifact. Minimum bundle per run:

```
.evidence/<batch-id>/
├── summary.md            # What ran, what passed/failed, duration
├── commands-run.txt      # Exact commands in order
├── exit-codes.json       # {"<command>": <exit_code>} map
└── toolchain.md          # Tool versions snapshot (from audit-toolchain.mjs)
```

Batch ID format: `<context>-YYYYMMDD-HHMM` (e.g., `pr-20260519-1430`, `nightly-20260519-0300`).

Schema: `schemas/evidence-bundle.schema.json` (W7).
Validator: `scripts/check-evidence-bundle.mjs` (W7, INV-90).

---

### TemplateContract

Every EJS template under `src/templates/` must satisfy:

1. **Named** — filename matches `<category>/<purpose>[.<ext>].ejs`
2. **Parameterized** — all project-specific values from `GeneratorContext` type; no hardcoded service names
3. **Gated** — `<% if (governanceLevel >= N) { %>` guards for M2/M3-only features (CANON-13)
4. **Referenced** — cited in the generator that emits it (`src/generators/*.ts`)
5. **Tested** — at least one fixture run validates the rendered output
6. **KIT-linked** — comment header `{{!-- KIT dim: N, M --}}` citing applicable dims

---

### ProjectConformanceCheck

A generated project is conformant when:

- All BLOCKING KIT dims applicable to its stack + maturity tier have gate scripts exiting 0
- `make gate` (or `./run.sh gate`) ↔ CI `01-pr-fast` parity hash matches
- Evidence bundle present after each gate run
- No suppression without rationale + expiry date (W6 validator)
- All anti-drift validators exit 0 on the project tree

Conformance is checked by `arbiter doctor` (existing CLI) + `scripts/check-self-dogfood.mjs`.

---

### LocalCICompatibilityContract

**Invariant (INV-87):** Every CI workflow job has an equivalent local command. Drift is a gate failure.

| CI workflow      | Local equivalent        | Max delta                       |
| ---------------- | ----------------------- | ------------------------------- |
| `01-pr-fast`     | `make gate`             | ±0 (same scripts, same flags)   |
| `02-pr-extended` | `make full`             | ±0                              |
| `06-nightly`     | `make simulate-nightly` | ±allowed-skips (env-only steps) |
| `07-weekly`      | `make simulate-weekly`  | ±allowed-skips                  |

The parity contract is machine-verified by `scripts/check-local-ci-parity.mjs`. A `parityContentHash` in `.arbiter/gate/local-result.json` must match the hash of the workflow job list.

---

## Arbiter Primitives Map

| Primitive Type  | Arbiter representation                                                             | Enforcement mechanism                           |
| --------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| Invariant rule  | `src/invariants/catalog.ts` entry + `GLOBAL_INVARIANTS.md`                         | `scripts/check-*.mjs` in gate                   |
| Gate script     | `scripts/check-*.mjs` (agnostic) or stack adapter emits                            | `check-all.mjs` orchestration                   |
| Git hook        | `.githooks/pre-commit` (arbiter-self) + `src/templates/hooks/*.ejs`                | `setup-repo.sh` installs                        |
| CI workflow     | `.github/workflows/*.yml` (arbiter-self) + `src/templates/github/workflows/*.ejs`  | Generator emits per tier                        |
| Generator       | `src/generators/*.ts`                                                              | `arbiter init` invokes                          |
| Template        | `src/templates/**/*.ejs`                                                           | EJS render via generator                        |
| Stack adapter   | `src/adapters/<stack>.ts` implementing `StackAdapter` interface                    | `src/adapters/_registry.ts`                     |
| Evidence        | `.evidence/<batch>/`                                                               | `scripts/evidence-rotate.mjs`                   |
| KIT catalog     | `src/kit/catalog.ts`                                                               | `scripts/check-kit-catalog-parity.mjs` (INV-86) |
| Makefile target | `Makefile` (arbiter-self) + `src/templates/local-wrapper/Makefile.ejs`             | `check-local-ci-parity.mjs`                     |
| ADR             | `docs/ADR/NNN-*.md` (arbiter-self) + referenced from `docs/REFERENCE/dim-NNN-*.md` | Docs only; no gate                              |
| Sub-agent       | `.claude/agents/*.md`                                                              | `.claude/settings.json` registration            |
| Agent command   | `.claude/commands/*.md`                                                            | Claude Code skill invocation                    |

---

## Dual-Track Realization Per Primitive

For every primitive introduced in W2-W11, both tracks ship in the same PR:

| Primitive     | Track A (arbiter-self)                    | Track B1 (EJS template)                                    | Track B2 (generator)                      | Track B3 (KIT doc)                           | Track B4 (invariant) |
| ------------- | ----------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- | -------------------- |
| Gate script   | `scripts/check-*.mjs`                     | `src/templates/scripts/*.mjs.ejs`                          | `src/generators/anti-drift-validators.ts` | `docs/REFERENCE/dim-NN-*.md`                 | INV-NN in catalog    |
| CI workflow   | `.github/workflows/*.yml`                 | `src/templates/github/workflows/*.yml.ejs`                 | `src/generators/github-workflows.ts`      | `docs/REFERENCE/ci-tier-workflows.md`        | INV-73 update        |
| Makefile      | `Makefile`                                | `src/templates/local-wrapper/Makefile.ejs`                 | `src/generators/local-wrapper.ts`         | `docs/REFERENCE/local-wrapper-contract.md`   | INV-87               |
| Stack adapter | `src/adapters/typescript.ts`              | n/a (adapter IS the template mechanism)                    | `src/adapters/_registry.ts`               | `docs/REFERENCE/stack-adapter-contract.md`   | INV-88               |
| KIT catalog   | `src/kit/catalog.ts`                      | `src/templates/kit/*.ejs`                                  | `src/generators/kit.ts`                   | `docs/REFERENCE/dim-001-*.md … dim-076-*.md` | INV-86               |
| Evidence      | `.evidence/<batch>/`                      | `src/templates/evidence/*.ejs`                             | `src/generators/test-taxonomy.ts`         | `docs/REFERENCE/evidence-schema.md`          | INV-90               |
| Supply chain  | `.github/workflows/05-release.yml`        | `src/templates/github/workflows/05-release.yml.ejs`        | `src/generators/github-workflows.ts`      | `docs/REFERENCE/supply-chain.md`             | INV-92               |
| AI-PR gate    | `.github/workflows/_label-on-approve.yml` | `src/templates/github/workflows/_label-on-approve.yml.ejs` | `src/generators/github-workflows.ts`      | `docs/REFERENCE/ai-pr-gate.md`               | INV-91               |

Not all four B sub-tracks apply to every primitive. The per-wave matrix in `docs/plans/planning-skeleton-migration-plan.md` specifies which.

---

## Architecture Questions (12)

### Q1 — How does the framework emit skeleton patterns to generated projects?

Every skeleton pattern has a corresponding EJS template under `src/templates/`. The `arbiter init` command (backed by `src/generators/*.ts`) renders templates parameterized by `GeneratorContext` (stack, governance level, project name). Generated projects receive an identical structural harness, not a copy of arbiter-self files.

### Q2 — How is the dual-track separation enforced?

CANON-04/05/07/11 (`.claude/rules/30-canon-enforcement.md`) require that any new gate/hook/template/generator satisfies the dual-track contract. `check-no-orphan-todo.mjs` and `pre-edit-plan-anchor.mjs` prevent solo-track implementations from entering the tree. `#dual-track-contract (this document)` is the binding contract.

### Q3 — How is local↔CI parity proven?

`scripts/check-local-ci-parity.mjs` computes a `parityContentHash` from the Makefile target list + CI workflow job list. Hash mismatch = gate fail (INV-87). Any drift that survives a gate run is a regression.

### Q4 — How are Java/Spring-specific patterns isolated?

Stack-specific dims (tag: `java_spring`) route to `src/adapters/java.ts` (F2). Core scripts and templates only reference `agnostic`-tagged dims. The `StackAdapter` interface (W5) is the only bridge; it returns `GateDescriptor[]` and `WorkflowTemplateRef[]`, not raw files.

### Q5 — How are KIT dims linked to invariants and scripts?

`src/kit/catalog.ts` is the SSOT. Each dim entry carries `invariant_id` (nullable). Each gate script cites `// KIT dim: N` in its header. `scripts/check-kit-catalog-parity.mjs` (INV-86) verifies that every dim with `gate_type: "BLOCKING"` has either an `invariant_id` or a `validator` in `framework_realization`.

### Q6 — How are suppressions handled?

Suppressions require: (1) a rationale comment, (2) an expiry date, (3) CODEOWNERS approval for suppression files. Enforced by `scripts/check-suppression-rationale.mjs` + `scripts/check-suppression-expiry.mjs` (W6, INV-89 family).

### Q7 — How does the evidence bundle prove conformance?

Every gate run writes to `.evidence/<batch>/`. The `schemas/evidence-bundle.schema.json` defines minimum required files. `scripts/check-evidence-bundle.mjs` validates every existing bundle against the schema (INV-90).

### Q8 — How does the AI-PR gate satisfy 21 CFR §11.10(g)?

`_label-on-approve.yml` applies `approved-by-human` only when: reviewer ≠ author AND reviewer.type ≠ Bot AND review.state = APPROVED. `_ai-draft-check.yml` blocks merge unless that label is present on AI-authored PRs. Triple-check documented in `docs/REFERENCE/ai-pr-gate.md`.

### Q9 — How are templates parameterized across 3 governance levels?

Generator context includes `governanceLevel: 1 | 2 | 3`. EJS templates use `<% if (governanceLevel >= 2) { %>` guards (CANON-13). Level 1 gets baseline harness; Level 2 adds extended checks; Level 3 adds pharma/supply-chain overlays.

### Q10 — How is INV-73 (CI tier presence) resolved across waves?

W4 ships 4 baseline workflows → INV-73 status: `transition`. W8 adds AI-PR workflows. W9 adds release. W10 adds nightly/weekly/heartbeat → INV-73 status: `closed` (8/8 tier workflows). The catalog entry tracks the transition state explicitly.

### Q11 — How does supply chain signing work in generated projects?

`src/templates/github/workflows/05-release.yml.ejs` + `sign-and-attest/action.yml.ejs` provide the signing composite action. Generated only for `governanceLevel >= 2`. At `governanceLevel == 3`, Trivy strict and SBOM attestation are mandatory (INV-92).

### Q12 — How does the anti-drift family stay current?

Each anti-drift validator in `scripts/check-*.mjs` must support `--help` (INV-89). New validators are added to `check-all.mjs` at L1 (fast, <5s) or L2 (slow). The drift map in `scripts/check-drift.mjs` maintains an explicit catalog of known-drift pairs. Any new workflow/template/invariant trio must have a corresponding drift-check entry.

---

## References

- `docs/plans/planning-skeleton-migration-plan.md` — wave execution playbook
- `#dual-track-contract (this document)` — binding dual-track contract
- `docs/audits/kit-canonical-mapping.json` — machine-readable 76-dim catalog
- `docs/audits/arbiter-skeleton-gap-analysis.md` — severity-rated gap matrix
- `docs/REFERENCE/external-kit-sources.md` — KIT XLSX pointer + refresh procedure
- `AGENTS.md` — invariants INV-73, INV-86..INV-93
