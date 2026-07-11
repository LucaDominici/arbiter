---
title: 'Contributing to arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-06-08'
owner: ''
canonical_id: 'CONTRIBUTING'
tags: ['audience/dev', 'kind/setup']
related: []
---

# Contributing to arbiter

Consolidated contributor guide: quickstart, repo setup, Windows/WSL2 install, coding standards, the getting-started development walkthrough, and contributor conventions. Sections below were previously separate files.

---

## arbiter — Quickstart

Five-minute install + first command + first gate run.

## 1. Install

```sh
npm install -g @arbiter/cli
# or run without installing
npx @arbiter/cli init
```

Requirements: Node.js ≥ 22, git ≥ 2.40.

## 2. Initialize a project

In a project directory:

```sh
arbiter init
```

`init` detects your stack (TypeScript / Python / Rust / Go / Java) and
governance level (L1 / L2 / L3 / L4), then materializes:

- `AGENTS.md` — invariant catalog
- `.claude/` or equivalent agent config
- `.githooks/` — pre-commit / pre-push hooks
- `.github/workflows/` — tiered CI workflows
- `scripts/check-all.mjs` — local gate orchestrator
- `arbiter.json` — project configuration

## 3. Run the gate

```sh
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```

L1 must pass before commit, L2 before push. The `.githooks/` scripts enforce
both automatically once the git hook path is configured.

## 4. Verify hooks

```sh
git config core.hooksPath
# expected: .githooks
```

If empty, run `git config core.hooksPath .githooks` once.

## 5. Open a task

```sh
/ship #NNN                      # in Claude Code (orchestration entrypoint)
arbiter ship #NNN --tier Standard   # equivalent CLI
```

`/ship` is the single orchestration entrypoint — it auto-sequences an issue through
plan → red-team → TDD impl → review → gate → merge. Use `/task` subcommands only
for low-level engine control or recovery (`arbiter task advance`, `record-red`, etc.).

## Common next reads

- [`README.md`](../README.md) — feature overview
- [Windows Setup (WSL2)](#windows-setup-wsl2) — extended install + per-stack notes
- [`GOVERNANCE.md`](./GOVERNANCE.md) — invariants + ADRs
- [`internal/architecture/ARCHITECTURE.md`](./internal/architecture/ARCHITECTURE.md) — system internals
- [`api/README.md`](./api/README.md) — public API surface
- [`OBSIDIAN.md`](../OBSIDIAN.md) — open this repo as an Obsidian vault

## When something fails

- Gate red on lint/format → `npm run format && npm run lint --fix`
- Gate red on tests → run the failing test in isolation; do not bypass with `--no-verify`
- Gate red on TDD evidence (#NNN.json missing) → `arbiter task record-red --test-path <file>`
- Self-hosted CI runner offline → set repo variable `CI_BUILD_RUNNER_LABEL=ubuntu-latest` (default already ubuntu-latest as of #959)

---

## Repository Setup (CANON-01)

Arbiter generates `scripts/setup-repo.sh` for target projects. This document covers the equivalent steps for the **arbiter repo itself**.

## One-time GitHub setup

These steps are idempotent — safe to re-run.

### Prerequisites

- `gh` CLI installed and authenticated (`gh auth login`)
- Admin access to the `arbiter` repository

### Labels

```bash
gh label create "task"        --color "0075ca" --description "Tracked work item"      --force
gh label create "bug"         --color "d73a4a" --description "Something isn't working" --force
gh label create "enhancement" --color "a2eeef" --description "New feature or request"  --force
gh label create "docs"        --color "0052cc" --description "Documentation only"      --force
gh label create "in-progress" --color "fbca04" --description "Work in progress"        --force
gh label create "in-review"   --color "e4e669" --description "Under review"            --force
```

### Branch protection

```bash
gh api \
  --method PUT \
  "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/branches/main/protection" \
  --field "required_status_checks[strict]=true" \
  --field "required_status_checks[contexts][]=ci" \
  --field "enforce_admins=false" \
  --field "required_pull_request_reviews[required_approving_review_count]=1" \
  --field "restrictions=null" \
  --field "allow_force_pushes=false" \
  --field "allow_deletions=false"
```

### CI runner

The self-hosted runner `docker-ci-build` must be registered and online for CI jobs to run (see INV-13 in `AGENTS.md`).

---

## Windows Setup (WSL2)

**Issue:** #543

arbiter does not support native Win32. Use WSL2 (Windows Subsystem for Linux).

---

## Requirements

- Windows 10 version 2004+ or Windows 11
- WSL2 enabled (not WSL1)
- Ubuntu 22.04 or later distribution recommended

---

## Step 1: Enable WSL2

Open PowerShell as Administrator:

```powershell
wsl --install
```

This installs WSL2 + Ubuntu by default. Restart when prompted.

Verify WSL2 is the default version:

```powershell
wsl --set-default-version 2
```

---

## Step 2: Install Node.js inside WSL2

Open the Ubuntu terminal and run:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should print v22.x.x
```

---

## Step 3: Install arbiter

```bash
npm install -g @arbiter/cli
arbiter --version
```

---

## Step 4: Verify your environment

```bash
arbiter doctor
```

All checks should PASS. If `git` is missing:

```bash
sudo apt-get install -y git
```

---

## Step 5: Initialize a project

```bash
cd /path/to/your/project
arbiter init
```

Your Windows filesystem is mounted at `/mnt/c/`. Example:

```bash
cd /mnt/c/Users/YourName/projects/my-app
arbiter init
```

---

## Troubleshooting

| Symptom                      | Fix                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `arbiter: command not found` | Check `npm bin -g` is in `$PATH`                          |
| `git not found`              | `sudo apt-get install git`                                |
| Slow filesystem on `/mnt/c/` | Clone repos inside `/home/<user>/` for better performance |
| WSL1 detected                | `wsl --set-version Ubuntu 2`                              |

---

## Decision Record

arbiter supports WSL2 only (not native Win32) — see locked decision in `docs/PRODUCT/DECISIONS.md` (C7). The rationale: bash-based hooks and shell scripts require a POSIX environment. WSL2 provides this without significant friction for Windows developers.

---

## Coding Standards

_Generated by arbiter. Update to match your team's conventions._

## General

- Prefer immutable variables (const/val/final)
- Functions should have a single responsibility
- No magic numbers — use named constants
- Maximum cyclomatic complexity: 15

## TypeScript

- `strict: true` in tsconfig — mandatory
- No `any` type — use `unknown` and narrow, or create proper types
- Named exports preferred over default exports
- File naming: kebab-case.ts
- Linting: ESLint with `@typescript-eslint` ruleset
- Dead code: Knip (zero unused exports)
- Coverage threshold: 80% lines

## L3 Governance

- All public APIs must have OpenAPI/Swagger documentation
- Breaking changes require an ADR
- Architectural decision records: `docs/internal/ADR/`
- Security review required for any auth, crypto, or external boundary changes

---

## Getting Started — Development Guide

This guide covers how to set up a local development environment, run the test suite, and extend arbiter with a new language detector or generator.

---

## Prerequisites

- **Node.js >= 20** — arbiter uses the native `node:fs`, `node:path`, and `node:child_process` APIs available since Node 18, but Node 20 is the minimum because `tsx` requires it.
- **npm >= 10** — comes bundled with Node 20.
- **gh CLI (optional)** — required only for running tests that exercise GitHub provisioning. See [ADR-003](internal/ADR/003-gh-cli-required.md).
- **Git** — must be on `PATH` for detector tests that call `git` CLI.

---

## Setup

```bash
git clone https://github.com/LucaDominici/arbiter.git
cd arbiter
npm ci
```

`npm ci` installs exact versions from `package-lock.json`. Do not use `npm install` in development — it can mutate the lockfile.

---

## Running Tests

```bash
npm test                   # full suite (vitest)
npm run test:watch         # watch mode during development
npm run test:coverage      # coverage report (threshold: 85%)
```

Tests use `vitest`. Each test that touches the filesystem creates a temporary directory under `os.tmpdir()` and cleans it up in `afterEach`. No test modifies the project source tree.

---

## Running the CLI Locally

```bash
# Self-test: run arbiter init on a temp directory
npx tsx src/cli.ts init --yes /tmp/arbiter-self-test

# Interactive wizard
npx tsx src/cli.ts init /tmp/my-project

# Other commands
npx tsx src/cli.ts update --yes /tmp/my-project
npx tsx src/cli.ts diff /tmp/my-project
```

`tsx` transpiles TypeScript on the fly. No build step is needed for local development. The published package runs a compiled `dist/` build via `tsc`.

---

## Project Structure

```
src/
  cli.ts                  # Entry point — parses argv, routes to commands
  commands/
    init.ts               # init command: detect -> wizard -> generate -> GitHub setup -> save config
    update.ts             # update command: reload config -> re-generate canonical files
    diff.ts               # diff command: show what would change on update
  detectors/
    language.ts           # typescript | java | rust | go | python | unknown
    framework.ts          # next | vue | react | express | spring-boot | quarkus | tauri | ...
    build.ts              # buildCommand, testCommand, lintCommand, formatCommand
    git.ts                # isGitRepo, remoteUrl, githubOwner, githubRepo
    github.ts             # gh CLI available, authenticated, username
    existing.ts           # agentsMd, claudeDir, agentsDir, aiRulez, settingsJson, checkAllScript
    language-hooks.ts     # LanguageHook[] per language
  generators/
    agents-md.ts          # AGENTS.md
    claude.ts             # .claude/ tree
    codex.ts              # .agents/ tree
    cursor.ts             # .cursorrules
    copilot.ts            # .github/copilot-instructions.md
    github.ts             # .github/ tree + branch protection + labels
    root.ts               # CODEOWNERS, SECURITY.md, CONTRIBUTING.md, .editorconfig
    check-all.ts          # scripts/check-all.mjs
    api-middleware.ts     # payload-size-limit, deprecation, correlation-id (API archetype)
    seed.ts               # scripts/seed-test-data.sh + lib/seed-common.sh (backend-web-db L2/L3)
  wizard/
    index.ts              # Interactive prompts (inquirer)
    defaults.ts           # --yes mode defaults
    types.ts              # ProjectConfig interface
  utils/
    fs.ts                 # writeFile, mergeSettingsJson, resolvedPath
    render.ts             # renderTemplate, renderString (EJS wrapper)
    config.ts             # save/load arbiter.json
  templates/              # EJS + static templates (230+ files across archetypes/languages/levels)
    middleware/           # API middleware: payload-size-limit, correlation-id, deprecation, error-handler
__tests__/
  detectors/              # Unit tests for each detector
  utils/                  # Unit tests for merge, config
  integration/            # Full init and update/diff flows
```

---

## How to Add a Language Detector

Arbiter detects the project language by looking for marker files in the target directory. All detection logic lives in `src/detectors/language.ts`.

**Step 1** — Add the language to the `Language` union in `src/wizard/types.ts`:

```typescript
export type Language = 'typescript' | 'java' | 'rust' | 'go' | 'python' | 'kotlin' | 'unknown'
```

**Step 2** — Add a detection case in `src/detectors/language.ts`:

```typescript
// Kotlin: build.gradle.kts or settings.gradle.kts
if (existsSync(join(dir, 'build.gradle.kts')) || existsSync(join(dir, 'settings.gradle.kts'))) {
  return 'kotlin'
}
```

Place the new case before the `unknown` fallback. More specific markers should come before more general ones (e.g., check `build.gradle.kts` before `build.gradle`).

**Step 3** — Add default commands in `src/detectors/build.ts`:

```typescript
case 'kotlin':
  return {
    buildCommand: './gradlew build',
    testCommand: './gradlew test',
    lintCommand: './gradlew ktlintCheck',
    formatCommand: './gradlew ktlintFormat',
  };
```

**Step 4** — Add language hooks in `src/detectors/language-hooks.ts` if applicable:

```typescript
case 'kotlin':
  return [
    { name: 'no-suppressed-warnings', matcher: '**/*.kt', command: 'scripts/check-suppress.sh' },
  ];
```

**Step 5** — Add a test in `__tests__/detectors/language.test.ts`:

```typescript
it('detects kotlin from build.gradle.kts', async () => {
  writeFileSync(join(tmpDir, 'build.gradle.kts'), '')
  expect(await detectLanguage(tmpDir)).toBe('kotlin')
})
```

---

## How to Add a Generator

A generator is a function that takes a `ProjectConfig` and returns a list of `WriteResult` objects (one per file written).

**Step 1** — Create `src/generators/my-tool.ts`:

```typescript
import { writeFile } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export async function generateMyTool(config: ProjectConfig): Promise<WriteResult[]> {
  const results: WriteResult[] = []

  const content = renderTemplate('my-tool/config.ejs', config)
  results.push(
    writeFile(
      join(config.targetDir, '.my-tool', 'config.yml'),
      content,
      { backup: true }, // or { skipIfExists: true } depending on the file type
    ),
  )

  return results
}
```

**Step 2** — Create the template at `src/templates/my-tool/config.ejs`. Use EJS syntax for dynamic content or write a static file if no `ProjectConfig` variables are needed. See [TEMPLATE-SYSTEM.md](internal/architecture/ARCHITECTURE.md) for the full variable reference.

**Step 3** — Wire the generator into `src/commands/init.ts` inside `runGenerators()`:

```typescript
import { generateMyTool } from '../generators/my-tool.js'

// Inside runGenerators():
if (config.tools.includes('my-tool')) {
  results.push(...(await generateMyTool(config)))
}
```

**Step 4** — Add the tool to the `tools` array type in `src/wizard/types.ts` and to the wizard prompt options in `src/wizard/index.ts`.

**Step 5** — Write an integration test in `__tests__/integration/init.test.ts` that verifies the generated file exists and contains expected content for at least one config variant.

---

## Code Quality

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run format     # prettier
```

All three must pass before committing. The CI workflow runs the same checks. See [Conventions](#conventions) for naming and style rules.

---

## Conventions

Coding conventions, naming rules, error handling patterns, and the PR checklist for arbiter contributors.

---

## File Naming

All source files use **kebab-case**:

```
src/detectors/language-hooks.ts   # correct
src/detectors/languageHooks.ts    # wrong
src/generators/check-all.ts       # correct
src/generators/checkAll.ts        # wrong
```

Template files follow the same rule. If the output filename contains dots or special characters, keep them in the template name:

```
src/templates/root/.editorconfig      # static file, output name preserved
src/templates/claude/settings.json.ejs  # .ejs extension appended
```

Test files use the kebab-case name of the module they test with `.test.ts` appended:

```
__tests__/detectors/language.test.ts
__tests__/utils/merge.test.ts
```

---

## Exports

**Named exports only.** No default exports anywhere in `src/`.

```typescript
// correct
export function detectLanguage(dir: string): Language { ... }
export type { ProjectConfig };

// wrong
export default function detectLanguage(...) { ... }
```

Named exports make imports explicit and easier to refactor. They also work correctly with tree-shaking in the compiled output.

---

## TypeScript

- **No `any`** — use `unknown` and narrow, or define a proper type.
- **`strict: true`** — the `tsconfig.json` enables `strict`. All flags it implies (`noImplicitAny`, `strictNullChecks`, etc.) must pass.
- **`import type`** — use `import type { Foo }` for type-only imports. This is enforced by eslint's `@typescript-eslint/consistent-type-imports` rule.
- **`.js` extension in imports** — Node ESM requires the `.js` extension even when the source is `.ts`. Always write:
  ```typescript
  import { writeFile } from '../utils/fs.js'
  ```

---

## Error Handling

Arbiter is a CLI tool. Errors fall into two categories:

**Fatal errors** (cannot continue): print to `stderr` and exit with code 1.

```typescript
console.error(`[arbiter] Fatal: ${message}`)
process.exit(1)
```

**Non-fatal errors** (operation can be skipped): catch and log a warning, continue.

```typescript
try {
  fs.chmodSync(scriptPath, 0o755)
} catch {
  // chmod can fail on some filesystems (e.g., Windows NTFS via WSL)
  // The file is still usable; skip silently.
}
```

Never throw from a generator or detector. Callers do not have try/catch around generator calls. If a generator cannot complete, it should log and return an empty result array rather than throwing.

**`loadConfig` error visibility:** `loadConfig` returns `null` for both missing and corrupt `arbiter.json`. When the file exists but cannot be parsed (invalid JSON), it emits `console.warn` before returning `null` so operators can distinguish corruption from absence. Callers that guard with `if (!stored)` will still exit with "No arbiter.json found" — the warn fires to stderr first. Do not add new silent `catch {}` in `loadConfig` or its callers.

**Adverse git state guard:** Commands that write files (`init`, `update`) call `detectAdverseGitState()` before generating. If a rebase, merge, cherry-pick, bisect, or detached HEAD is detected, the command throws a `UserFacingError` with a fix suggestion. Pass `--force` to override — the guard will warn to stderr and continue instead of aborting. See `src/detectors/git.ts::detectAdverseGitState`.

**Atomic writes:** All file writes go through `src/utils/fs.ts::writeFile`, which uses `atomicWrite()` internally: content is written to a `.arbiter-tmp-<timestamp>` sibling, then renamed into place. If `renameSync` fails with `ENOSPC` (disk full), a `UserFacingError` is thrown with a `df -h` hint. The temp file is cleaned up on any error.

---

## Shared Detector Utilities

`src/detectors/axis.ts` is the canonical module for archetype axis-field resolution:

- **`ARCHETYPE_DB_SET: ReadonlySet<Archetype>`** — set of archetypes that have a database by default (`backend-web-db`, `data-pipeline`). All code that needs to check "does this archetype imply a database?" must use this set — no inline string literals.
- **`resolveAxisFields(stored, targetDir, language, framework)`** — computes the six axis fields (`archetype`, `architectureStyle`, `isMultiTenant`, `hasDatabase`, `hasPublicApi`, `contractType`) from stored config with detection fallback. All commands that build a `ProjectConfig` from stored config must call this helper — do not inline the resolution logic.

---

## Commit Format

```
type(scope): summary

[optional body]
```

**Types:**

| Type       | When to use                         |
| ---------- | ----------------------------------- |
| `feat`     | New feature or command              |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `test`     | Test additions or corrections       |
| `refactor` | Code change with no behavior change |
| `chore`    | Dependency updates, build config    |
| `ci`       | CI workflow changes                 |

**Scope** is the module or area affected: `detectors`, `generators`, `templates`, `utils`, `cli`, `docs`, `deps`.

**Examples:**

```
feat(generators): add Gemini CLI overlay generator
fix(detectors): detect Bun projects via bun.lockb
docs(adr): add ADR-012 for Gemini CLI thin pointer
test(integration): verify ai-rulez coexistence skip
chore(deps): bump ejs to 3.1.10
```

Keep summaries under 72 characters. If more context is needed, add it in the body after a blank line.

---

## PR Checklist

Before opening a pull request, verify:

- [ ] `npm test` passes with no failures.
- [ ] `npm run test:coverage` reports >= 85% line coverage.
- [ ] `npm run lint` reports no errors.
- [ ] `npm run typecheck` reports no errors.
- [ ] New behavior has at least one test (detector, util, or integration).
- [ ] New ADR written if a significant architectural decision was made.
- [ ] `docs/internal/ADR/README.md` updated with the new ADR row.
- [ ] No changes to `src/templates/` without a corresponding test verifying the generated output.
- [ ] Commit messages follow the `type(scope): summary` format.
- [ ] PR title matches the primary commit type and scope.

---

## Dependencies

- **Add runtime dependencies sparingly.** Arbiter's value is zero-install via `npx`. Each added dependency increases the install footprint and attack surface.
- **Prefer Node built-ins.** `node:fs`, `node:path`, `node:child_process`, `node:os` cover most needs.
- **Dev dependencies are unrestricted.** Vitest, eslint, prettier, tsx, and TypeScript are dev-only and do not affect the published package size.
- **Any new runtime dependency requires a comment** in the relevant generator or util explaining why a built-in could not be used.

---

## Post-Emit Formatting

Generated files that use arbiter's internal code style (single-quotes, no semicolons) must be
re-formatted to match the target project's `.prettierrc` after being written. Use
`src/utils/prettier-format.ts` (`prettierFormat(filePath, targetDir)`) for this — it is
CANON-12 compliant (uses `runCli`), best-effort (warns on failure, never throws), and skips
silently when prettier is not available in the target environment (#933 F13).

Resolution order: arbiter's own bundled prettier (via `createRequire` — deterministic, since a
fresh target scaffold has no `node_modules` yet and `npx` resolution from the target dir depends
on the npx cache matching the registry's latest release), then the target's own prettier via
`npx --no-install`, then silent skip.
