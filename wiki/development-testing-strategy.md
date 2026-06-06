---
generated: true
source: 'docs/DEVELOPMENT/TESTING-STRATEGY.md'
source_sha: '0263529acd1e710c518fdadd3722d11c39b63703'
last_updated: '2026-06-06'
---

# Testing Strategy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/DEVELOPMENT/TESTING-STRATEGY.md](../docs/DEVELOPMENT/TESTING-STRATEGY.md)

# Testing Strategy

This document describes arbiter's test structure, conventions, fixture approach, and coverage targets. All claims here are grounded in the actual test files under `__tests__/`.

---

## Current Test Suite

515+ test files across detectors, utils, generators, templates, integration, behavioral, brownfield, matrix, and governance categories. Key areas:

| Category                 | Files                                 | What it covers                                                      |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| `__tests__/detectors/`   | 6 files                               | Language, framework, build, git, hooks, existing-state detection    |
| `__tests__/utils/`       | 4 files                               | fs, merge, config, render utilities                                 |
| `__tests__/generators/`  | 8 files                               | Per-generator output verification (agents-md, claude, codex, etc.)  |
| `__tests__/tools/`       | 5 files                               | Per-tool end-to-end output (Claude, Codex, Cursor, Copilot, GitHub) |
| `__tests__/matrix/`      | 6 files (5 per-stack + cross-product) | Stack-specific generation + INV-11 cross-product combinations       |
| `__tests__/templates/`   | 4 files                               | EJS template rendering across stacks, governance levels, and tools  |
| `__tests__/governance/`  | 1 file                                | Governance level effects on AGENTS.md and check-all.mjs             |
| `__tests__/integration/` | 19 files                              | Full `runInit` / `update` / `diff` command flows + gate scenarios   |
| `__tests__/behavioral/`  | 1 file                                | Real CLI spawn tests: `--version`, `--help`, init E2E, dry-run      |
| `__tests__/brownfield/`  | 4 files                               | Coexistence, backup, and merge scenarios for existing projects      |
| `__tests__/wizard/`      | 2 files                               | Wizard prompts, dry-run, greenfield/brownfield flow                 |

---

## Test Categories

### Unit Tests

Unit tests cover a single function or module in isolation. They use `vitest`'s `it`/`expect` API and make no network calls or `git`/`gh` CLI calls. Filesystem interaction is limited to the temp directory created for each test.

**Detectors** (`__tests__/detectors/`) — test the detection logic by placing marker files in a temp directory and asserting the returned value. For example, `language.test.ts` creates a `package.json` in a temp dir and asserts `detectLanguage(tmpDir)` returns `'typescript'`.

**Utils** (`__tests__/utils/`) — test pure utility functions. `merge.test.ts` calls `mergeSettingsJson(existing, incoming)` with fixture objects and asserts the merged output. No filesystem access.

### Behavioral Tests

Behavioral tests (`__tests__/behavioral/`) spawn the real `dist/cli.js` binary via `spawnSync` and assert observable output and exit-code invariants. They test the full composed pipeline — CLI parsing, command dispatch, and generator output — without mocking any internals. Requires `npm run build` to produce `dist/cli.js` before running.

Current coverage: top-level surface (`--version`, `--help`, unknown command, `init --help`), E2E init (creates `arbiter.json`, reports files created), dry-run (no `arbiter.json` created), `update` contract.

Behavioral tests run as part of the default `npm test` unit suite (included by `vitest.config.ts`), so they appear in coverage and CI unit-test counts.

### Integration Tests

Integration tests exercise the full command flow end-to-end within a temp directory. They call `runInit(config)` or the equivalent command function directly (no subprocess), let it run all detectors and generators, then assert on the filesystem state.

Key scenarios covered in `init.test.ts`:

- `AGENTS.md` is generated and contains the project name.
- `CLAUDE.md` opens with the thin pointer block.
- Hook files are created with `skipIfExists: true` (re-running init does not overwrite them).
- `settings.json` is deep-merged when it already exists (existing hooks preserved, new hooks added).
- When `aiRulez` is detected, tool configs are not generated (only `AGENTS.md` and GitHub files).

---

## Fixture Approach

Each test that touches the filesystem follows this pattern:

```typescript
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})
```

**Why temp directories:**

- Tests are fully isolated — no test can affect another's filesystem state.
- Cleanup is deterministic — `afterEach` removes the directory even if the test fails.
- No mocking of `fs` — tests exercise the real `writeFile` and `readFileSync` implementations, so they catch path or permission bugs that mocks would miss.

**Constructing fixtures:** Tests place only the marker files needed for the scenario being tested. For a TypeScript project, that means `writeFileSync(join(tmpDir, 'package.json'), '{}')`. This keeps each test minimal and easy to reason about.

---

## Test File Naming

Test files mirror the `src/` structure under `__tests__/`:

```
src/detectors/language.ts          ->  __tests__/detectors/language.test.ts
src/utils/merge.ts                 ->  __tests__/utils/merge.test.ts
src/commands/init.ts               ->  __tests__/integration/init.test.ts
```

Integration tests live under `__tests__/integration/` (19 files) rather than mirroring a single source file, because they exercise multiple modules together.

---

## Coverage Target

**85% line coverage** is the project target, enforced in CI via `vitest --coverage`. The threshold is configured in `vitest.config.ts`.

Coverage is a floor, not a goal. The meaningful test criterion is: every behavior documented in the README or a feature ADR must have a corresponding test. Coverage numbers follow from that; chasing the number without testing documented behavior is not acceptable.

---

## Matrix Testing (INV-11)

INV-11 requires that every generated template/artifact is tested across all supported stacks (TS, Java, Rust, Go, Python) × tools (Claude, Codex, Cursor, Copilot) × governance levels (L1, L2, L3).

### Coverage approach

**Per-dimension tests** (existing):

- `__tests__/matrix/{typescript,java,rust,go,python}.test.ts` — one stack at a time, always L2, uses `runGenerators()` end-to-end
- `__tests__/governance/levels.test.ts` — three governance levels, always TypeScript
- `__tests__/templates/commands-{claude,tools,governance}.test.ts` — stack or level independently

**Cross-product tests** (`__tests__/matrix/cross-product.test.ts`):

Tests the combinations where both stack and governance level interact in template logic. All cross-product tests use `renderTemplate()` (no filesystem setup) for speed. Coverage:

| Template            | Combinations tested                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `AGENTS.md.ejs`     | 5 stacks × 3 levels: governance policy markers, language invariant isolation, L3 SSOT invariants |
| `ci.yml.ejs`        | 5 stacks × 3 levels: `docs-check` presence/absence, language setup steps                         |
| `check-all.mjs.ejs` | 5 stacks: per-language check commands; documents Go/Python fallback behavior                     |
| `task.md.ejs`       | 5 stacks × 3 levels: testCommand in output, governance structure (tier/TDD/verification)         |

### Adding cross-product tests

When adding a new template that is parameterized by both `language` and `governanceLevel`, add cross-product coverage to `

_[content truncated — see source for full text]_
