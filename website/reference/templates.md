---
title: 'Template Inventory'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Template Inventory

Reference for all EJS templates shipped with Arbiter. Each entry documents the output file, template variables, and conditional branches.

All templates live under `src/templates/` and are rendered by `ejs` using the `ProjectConfig` context object.

---

## Template Variables (Common)

| Variable          | Type           | Example                  | Description                                                                 |
| ----------------- | -------------- | ------------------------ | --------------------------------------------------------------------------- |
| `projectName`     | string         | `my-app`                 | Inferred from directory name or git repo                                    |
| `language`        | string         | `typescript`             | Detected language (`typescript`, `java`, `rust`, `go`, `python`, `unknown`) |
| `framework`       | string \| null | `express+react`          | Detected framework (null if none)                                           |
| `buildTool`       | string         | `npm`                    | Build system (`npm`, `cargo`, `gradle`, `go`, `pip`)                        |
| `testCommand`     | string         | `npm test`               | Full test command                                                           |
| `lintCommand`     | string         | `npm run lint`           | Full lint command                                                           |
| `formatCommand`   | string         | `npx prettier --check .` | Full format command                                                         |
| `governanceLevel` | string         | `L2`                     | Governance tier (`L1`, `L2`, `L3`)                                          |
| `tools`           | string[]       | `["claude","codex"]`     | Selected AI tools                                                           |
| `useGitHub`       | boolean        | `true`                   | Whether GitHub setup is enabled                                             |

---

## What Gets Generated

| File / Directory                   | Always | Claude | Codex | GitHub |
| ---------------------------------- | ------ | ------ | ----- | ------ |
| `AGENTS.md`                        | ✓      |        |       |        |
| `.claude/CLAUDE.md`                |        | ✓      |       |        |
| `.claude/settings.json`            |        | ✓      |       |        |
| `.claude/hooks/`                   |        | ✓      |       |        |
| `.claude/rules/`                   |        | ✓      |       |        |
| `.agents/CODEX.md`                 |        |        | ✓     |        |
| `.agents/rules/`                   |        |        | ✓     |        |
| `.github/workflows/ci.yml`         |        |        |       | ✓      |
| `.github/PULL_REQUEST_TEMPLATE.md` |        |        |       | ✓      |
| `.github/ISSUE_TEMPLATE/`          |        |        |       | ✓      |
| `.github/dependabot.yml`           |        |        |       | ✓      |
| `SECURITY.md`                      |        |        |       | ✓      |
| `.editorconfig`                    |        |        |       | ✓      |
| `scripts/check-all.mjs`            |        |        |       | ✓      |

---

## AGENTS.md

**Template:** `src/templates/agents-md/AGENTS.md.ejs`
**Always generated:** Yes (canonical governance file)

### Conditional Branches

| Condition                   | Effect                                                   |
| --------------------------- | -------------------------------------------------------- |
| `framework` truthy          | Appends ` / <framework>` to Stack row                    |
| `language` (per stack)      | Language-specific invariants (data-driven, from catalog) |
| `governanceLevel` (L2+)     | INV-26 (TDD) gated at L2+; INV-27/28 gated at L3         |
| `language === 'typescript'` | TypeScript-specific coding standards                     |
| `governanceLevel === 'L1'`  | L1: unit tests, 70% coverage target                      |
| `governanceLevel === 'L2'`  | L2: 80% coverage, integration tests, TDD preferred       |
| `governanceLevel === 'L3'`  | L3: 85% coverage, E2E, evidence artifacts, TDD required  |

---

## `.claude/settings.json`

**Generated when:** `tools` includes `claude`

### Conditional Branches

| Condition                  | Effect                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `languageHooks` (iterated) | Adds language-specific PostToolUse hooks to Edit\|Write matcher |
| `buildTool === 'npm'`      | Adds `npm run *`, `npx *`, `node *` to permissions allow list   |
| `buildTool === 'cargo'`    | Adds `cargo *` to permissions allow list                        |
| `buildTool === 'gradle'`   | Adds `./gradlew *`, `gradle *` to permissions allow list        |

---

## `.github/workflows/ci.yml`

**Generated when:** `useGitHub` is true

### Conditional Branches

| Condition                   | CI Job Steps                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `language === 'typescript'` | Node setup, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test -- --coverage` |
| `language === 'rust'`       | Rust stable (clippy + rustfmt), `cargo fmt --check`, `cargo clippy`, `cargo test`   |
| `language === 'java'`       | Java 21 Temurin, Gradle setup, `./gradlew checkstyleMain`, `./gradlew test`         |

All variants include a `ci-required` rollup job.

---

## `scripts/check-all.mjs`

**Generated when:** `useGitHub` is true

### Conditional Branches

| Condition                   | L1 Checks                                                    | L2 Checks                      |
| --------------------------- | ------------------------------------------------------------ | ------------------------------ |
| `language === 'typescript'` | `tsc --noEmit`, `prettier --check`, `eslint src`, `npm test` | `npm audit --audit-level=high` |
| `language === 'rust'`       | `cargo fmt --check`, `cargo clippy`, `cargo test`            | `cargo audit`                  |
| `language === 'java'`       | `./gradlew checkstyleMain`, `./gradlew test`                 | `./gradlew integrationTest`    |
