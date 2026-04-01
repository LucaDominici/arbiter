# Getting Started — Development Guide

This guide covers how to set up a local development environment, run the test suite, and extend arbiter with a new language detector or generator.

---

## Prerequisites

- **Node.js >= 20** — arbiter uses the native `node:fs`, `node:path`, and `node:child_process` APIs available since Node 18, but Node 20 is the minimum because `tsx` requires it.
- **npm >= 10** — comes bundled with Node 20.
- **gh CLI (optional)** — required only for running tests that exercise GitHub provisioning. See [ADR-003](../ADR/003-gh-cli-required.md).
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
    existing.ts           # agentsMd, claudeDir, agentsDir, aiRulez, settingsJson, checkAllSh
    language-hooks.ts     # LanguageHook[] per language
  generators/
    agents-md.ts          # AGENTS.md
    claude.ts             # .claude/ tree
    codex.ts              # .agents/ tree
    cursor.ts             # .cursorrules
    copilot.ts            # .github/copilot-instructions.md
    github.ts             # .github/ tree + branch protection + labels
    root.ts               # CODEOWNERS, SECURITY.md, CONTRIBUTING.md, .editorconfig
    check-all.ts          # scripts/check-all.sh
  wizard/
    index.ts              # Interactive prompts (inquirer)
    defaults.ts           # --yes mode defaults
    types.ts              # ProjectConfig interface
  utils/
    fs.ts                 # writeFile, mergeSettingsJson, resolvedPath
    render.ts             # renderTemplate, renderString (EJS wrapper)
    config.ts             # save/load arbiter.json
  templates/              # 32 template files (.ejs + static)
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
export type Language = 'typescript' | 'java' | 'rust' | 'go' | 'python' | 'kotlin' | 'unknown';
```

**Step 2** — Add a detection case in `src/detectors/language.ts`:

```typescript
// Kotlin: build.gradle.kts or settings.gradle.kts
if (existsSync(join(dir, 'build.gradle.kts')) || existsSync(join(dir, 'settings.gradle.kts'))) {
  return 'kotlin';
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
  writeFileSync(join(tmpDir, 'build.gradle.kts'), '');
  expect(await detectLanguage(tmpDir)).toBe('kotlin');
});
```

---

## How to Add a Generator

A generator is a function that takes a `ProjectConfig` and returns a list of `WriteResult` objects (one per file written).

**Step 1** — Create `src/generators/my-tool.ts`:

```typescript
import { writeFile } from '../utils/fs.js';
import { renderTemplate } from '../utils/render.js';
import type { ProjectConfig } from '../wizard/types.js';
import type { WriteResult } from '../utils/fs.js';

export async function generateMyTool(config: ProjectConfig): Promise<WriteResult[]> {
  const results: WriteResult[] = [];

  const content = renderTemplate('my-tool/config.ejs', config);
  results.push(writeFile(
    join(config.targetDir, '.my-tool', 'config.yml'),
    content,
    { backup: true }  // or { skipIfExists: true } depending on the file type
  ));

  return results;
}
```

**Step 2** — Create the template at `src/templates/my-tool/config.ejs`. Use EJS syntax for dynamic content or write a static file if no `ProjectConfig` variables are needed. See [TEMPLATE-SYSTEM.md](../ARCHITECTURE/TEMPLATE-SYSTEM.md) for the full variable reference.

**Step 3** — Wire the generator into `src/commands/init.ts` inside `runGenerators()`:

```typescript
import { generateMyTool } from '../generators/my-tool.js';

// Inside runGenerators():
if (config.tools.includes('my-tool')) {
  results.push(...await generateMyTool(config));
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

All three must pass before committing. The CI workflow runs the same checks. See [CONVENTIONS.md](CONVENTIONS.md) for naming and style rules.
