# Template Inventory

Reference for all EJS templates shipped with Arbiter. Each entry documents the output file, template variables, and conditional branches.

All templates live under `src/templates/` and are rendered by `ejs` using the `ProjectConfig` context object (see `src/wizard/types.ts`).

---

## Template Variables (Common)

These variables are available to every template via `ProjectConfig`:

| Variable          | Type           | Example                  | Description                                                                 |
| ----------------- | -------------- | ------------------------ | --------------------------------------------------------------------------- |
| `projectName`     | string         | `my-app`                 | Inferred from directory name or git repo                                    |
| `description`     | string         | `my-app project`         | Short project description                                                   |
| `language`        | string         | `typescript`             | Detected language (`typescript`, `java`, `rust`, `go`, `python`, `unknown`) |
| `framework`       | string \| null | `express+react`          | Detected framework (null if none)                                           |
| `buildTool`       | string         | `npm`                    | Build system (`npm`, `cargo`, `gradle`, `go`, `pip`)                        |
| `buildCommand`    | string         | `npm run build`          | Full build command                                                          |
| `testCommand`     | string         | `npm test`               | Full test command                                                           |
| `lintCommand`     | string         | `npm run lint`           | Full lint command                                                           |
| `formatCommand`   | string         | `npx prettier --check .` | Full format command                                                         |
| `governanceLevel` | string         | `L2`                     | Governance tier (`L1`, `L2`, `L3`)                                          |
| `tools`           | string[]       | `["claude","codex"]`     | Selected AI tools                                                           |
| `useGitHub`       | boolean        | `true`                   | Whether GitHub setup is enabled                                             |
| `githubOwner`     | string \| null | `LucaDominici`           | GitHub org or username                                                      |
| `githubRepo`      | string \| null | `my-app`                 | GitHub repository name                                                      |
| `languageHooks`   | LanguageHook[] | (see Hooks doc)          | Language-specific hook definitions                                          |

---

## AGENTS.md

**Template:** `src/templates/agents-md/AGENTS.md.ejs`
**Output:** `AGENTS.md` (project root)
**Always generated:** Yes (canonical governance file)

### Variables Used

`projectName`, `description`, `language`, `framework`, `buildCommand`, `testCommand`, `lintCommand`, `formatCommand`, `governanceLevel`

### Conditional Branches

| Condition                   | Section Affected  | Effect                                                            |
| --------------------------- | ----------------- | ----------------------------------------------------------------- |
| `framework` truthy          | Project table     | Appends ` / <framework>` to Stack row                             |
| `language === 'java'`       | Invariants Tier 1 | Adds INV-03 (hexagonal architecture)                              |
| `language === 'typescript'` | Invariants Tier 2 | Adds INV-04 (no `any`), INV-05 (no unused exports)                |
| `language === 'rust'`       | Invariants Tier 2 | Adds INV-04 (no `.unwrap()`), INV-05 (no `unsafe`)                |
| `language === 'java'`       | Invariants Tier 2 | Adds INV-04 (no raw types), INV-05 (complexity limits)            |
| `governanceLevel === 'L3'`  | Invariants Tier 3 | Adds INV-11 (evidence artifacts), INV-12 (SSOT drift check)       |
| `language === 'typescript'` | Coding Standards  | TypeScript-specific rules (strict mode, no `any`, etc.)           |
| `language === 'rust'`       | Coding Standards  | Rust-specific rules (doc comments, `?` operator, clippy pedantic) |
| `language === 'java'`       | Coding Standards  | Java-specific rules (hexagonal, constructor injection, records)   |
| `governanceLevel === 'L1'`  | Testing Policy    | L1: unit tests, 70% coverage target                               |
| `governanceLevel === 'L2'`  | Testing Policy    | L2: 80% coverage, integration tests, TDD preferred                |
| `governanceLevel === 'L3'`  | Testing Policy    | L3: 85% coverage, E2E, evidence artifacts, TDD required           |

---

## Claude Code Templates

### `.claude/CLAUDE.md`

**Template:** `src/templates/claude/CLAUDE.md.ejs`
**Output:** `.claude/CLAUDE.md`
**Generated when:** `tools` includes `claude`

**Variables Used:** `projectName`, `language`

**Conditional Branches:**

| Condition                   | Effect                             |
| --------------------------- | ---------------------------------- |
| `language === 'typescript'` | Adds `check-no-any.sh` hook row    |
| `language === 'rust'`       | Adds `check-no-unwrap.sh` hook row |

### `.claude/settings.json`

**Template:** `src/templates/claude/settings.json.ejs`
**Output:** `.claude/settings.json`
**Generated when:** `tools` includes `claude`

**Variables Used:** `buildTool`, `languageHooks`

**Conditional Branches:**

| Condition                  | Effect                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `languageHooks` (iterated) | Adds language-specific PostToolUse hooks to Edit\|Write matcher |
| `buildTool === 'npm'`      | Adds `npm run *`, `npx *`, `node *` to permissions allow list   |
| `buildTool === 'cargo'`    | Adds `cargo *` to permissions allow list                        |
| `buildTool === 'gradle'`   | Adds `./gradlew *`, `gradle *` to permissions allow list        |

### `.claude/hooks/lib.sh`

**Template:** `src/templates/claude/hooks/lib.sh.ejs`
**Output:** `.claude/hooks/lib.sh`
**Generated when:** `tools` includes `claude`

**Variables Used:** `projectName`

**Conditional Branches:** None. Pure utility library (logging functions).

### `.claude/hooks/post-commit-check.sh`

**Template:** `src/templates/claude/hooks/post-commit-check.sh.ejs`
**Output:** `.claude/hooks/post-commit-check.sh`
**Generated when:** `tools` includes `claude`

**Variables Used:** None (static script).

**Conditional Branches:** None. Checks conventional commit format via regex.

### `.claude/rules/90-exec-protocol.md`

**Template:** `src/templates/claude/rules/90-exec-protocol.md.ejs`
**Output:** `.claude/rules/90-exec-protocol.md`
**Generated when:** `tools` includes `claude`

**Variables Used:** None (static content).

**Conditional Branches:** None.

---

## Codex Templates

### `.agents/CODEX.md`

**Template:** `src/templates/codex/CODEX.md.ejs`
**Output:** `.agents/CODEX.md`
**Generated when:** `tools` includes `codex`

**Variables Used:** `projectName`

**Conditional Branches:** None.

### `.agents/rules/90-exec-protocol.md`

**Template:** `src/templates/codex/rules/90-exec-protocol.md.ejs`
**Output:** `.agents/rules/90-exec-protocol.md`
**Generated when:** `tools` includes `codex`

**Variables Used:** None (static content, identical to Claude version).

**Conditional Branches:** None.

---

## Cursor Template

### `.cursorrules`

**Template:** `src/templates/cursor/.cursorrules.ejs`
**Output:** `.cursorrules` (project root)
**Generated when:** `tools` includes `cursor`

**Variables Used:** `projectName`, `language`, `framework`, `buildCommand`, `testCommand`

**Conditional Branches:**

| Condition          | Effect                                   |
| ------------------ | ---------------------------------------- |
| `framework` truthy | Appends ` / <framework>` to Language row |

---

## Copilot Template

### `.github/copilot-instructions.md`

**Template:** `src/templates/copilot/copilot-instructions.md.ejs`
**Output:** `.github/copilot-instructions.md`
**Generated when:** `tools` includes `copilot`

**Variables Used:** `projectName`, `language`, `framework`, `buildCommand`, `testCommand`, `lintCommand`

**Conditional Branches:**

| Condition          | Effect                                   |
| ------------------ | ---------------------------------------- |
| `framework` truthy | Appends ` / <framework>` to Language row |

---

## GitHub Templates

### `.github/workflows/ci.yml`

**Template:** `src/templates/github/workflows/ci.yml.ejs`
**Output:** `.github/workflows/ci.yml`
**Generated when:** `useGitHub` is true

**Variables Used:** `language`

**Conditional Branches:**

| Condition                   | CI Job Steps                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `language === 'typescript'` | Node 20 setup, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test -- --coverage`      |
| `language === 'rust'`       | Rust stable toolchain (clippy + rustfmt), `cargo fmt --check`, `cargo clippy`, `cargo test` |
| `language === 'java'`       | Java 21 Temurin, Gradle setup, `./gradlew checkstyleMain`, `./gradlew test`                 |

All variants include a `ci-required` rollup job that gates on `lint-and-test`.

### `.github/dependabot.yml`

**Template:** `src/templates/github/dependabot.yml.ejs`
**Output:** `.github/dependabot.yml`
**Generated when:** `useGitHub` is true

**Variables Used:** `buildTool`

**Conditional Branches:**

| Condition                | Package Ecosystem |
| ------------------------ | ----------------- |
| `buildTool === 'npm'`    | `npm`             |
| `buildTool === 'cargo'`  | `cargo`           |
| `buildTool === 'gradle'` | `gradle`          |

All variants also include `github-actions` ecosystem (always present).

---

## Root Templates

### `CODEOWNERS`

**Template:** `src/templates/root/CODEOWNERS.ejs`
**Output:** `CODEOWNERS` (project root)
**Generated when:** `useGitHub` is true

**Variables Used:** `githubOwner`

**Conditional Branches:** None. Single line: `* @<githubOwner>`.

### `CONTRIBUTING.md`

**Template:** `src/templates/root/CONTRIBUTING.md.ejs`
**Output:** `CONTRIBUTING.md` (project root)
**Generated when:** `useGitHub` is true

**Variables Used:** `projectName`, `testCommand`, `lintCommand`, `formatCommand`, `language`, `githubOwner`, `githubRepo`

**Conditional Branches:**

| Condition                   | Effect                        |
| --------------------------- | ----------------------------- |
| `language === 'typescript'` | Adds "No `any` types" rule    |
| `language === 'rust'`       | Adds "No `.unwrap()`" rule    |
| `lintCommand` truthy        | Adds lint command reference   |
| `formatCommand` truthy      | Adds format command reference |

### `SECURITY.md`

**Template:** `src/templates/root/SECURITY.md.ejs`
**Output:** `SECURITY.md` (project root)
**Generated when:** `useGitHub` is true

**Variables Used:** `projectName`

**Conditional Branches:** None.

---

## Scripts

### `scripts/check-all.sh`

**Template:** `src/templates/scripts/check-all.sh.ejs`
**Output:** `scripts/check-all.sh` (executable)
**Generated when:** `useGitHub` is true

**Variables Used:** `projectName`, `language`

**Conditional Branches:**

| Condition                   | L1 Checks                                                    | L2 Checks                      |
| --------------------------- | ------------------------------------------------------------ | ------------------------------ |
| `language === 'typescript'` | `tsc --noEmit`, `prettier --check`, `eslint src`, `npm test` | `npm audit --audit-level=high` |
| `language === 'rust'`       | `cargo fmt --check`, `cargo clippy`, `cargo test`            | `cargo audit`                  |
| `language === 'java'`       | `./gradlew checkstyleMain`, `./gradlew test`                 | `./gradlew integrationTest`    |
