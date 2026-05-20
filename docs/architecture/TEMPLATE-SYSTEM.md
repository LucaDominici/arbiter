---
title: 'Template System'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Template System

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
