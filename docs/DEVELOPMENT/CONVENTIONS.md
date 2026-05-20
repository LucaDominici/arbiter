---
title: 'Conventions'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Conventions

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
- [ ] `docs/ADR/README.md` updated with the new ADR row.
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
