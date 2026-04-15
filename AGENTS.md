# arbiter — AGENTS.md

> **Canonical governance for AI coding agents.**
> All tools read this file. Tool-specific extensions: `.claude/CLAUDE.md`, `.agents/CODEX.md`
>
> Standard: [AGENTS.md — AAIF / Linux Foundation](https://agents.md/)

---

## Project

| Fact      | Value                                                  |
| --------- | ------------------------------------------------------ |
| **What**  | arbiter project                                        |
| **Stack** | typescript                                             |
| **Build** | `npm run build`                                        |
| **Test**  | `npm run test`                                         |
| **Gate**  | `node scripts/check-all.mjs` (mandatory before commit) |

---

## Authority Hierarchy

When documents conflict, higher level wins. No debate.

```
Level 1:  AGENTS.md — invariants + governance (this file)
Level 2:  Architecture docs (docs/SYSTEM/ARCHITECTURE.md, PROJECT_STATUS.md)
Level 3:  Source code + tests — implementation truth
```

---

## Invariants

Violation protocol: **STOP → REFUSE → cite INV-XX**.

### Tier 1: Architectural Integrity

- **INV-01:** No circular dependencies between modules
- **INV-02:** Public API surface must be intentional — no accidental exports
- **INV-12:** No direct `child_process` usage in `src/**/*.ts` (runtime TypeScript). All CLI invocations go through `src/utils/run-cli.ts`. EJS templates under `src/templates/` are stand-alone scripts shipped to target projects and are exempt. No MCP server is a hard or soft dependency of arbiter or its generated artifacts (see [ADR-020](docs/ADR/020-cli-first-over-mcp.md)).

### Tier 2: Code Quality

- **INV-04:** No `any` type in TypeScript (enforced by hook + CI)
- **INV-05:** No unused exports (dead code elimination)
- **INV-06:** Every TODO comment must reference a task ID: `TODO(#NNN)`

### Tier 3: Process

- **INV-07:** Branch naming: `task/#NNN-description`
- **INV-08:** No direct commits to `main` — all changes via task branches + PR
- **INV-09:** Gate must pass before commit: `node scripts/check-all.mjs L1`
- **INV-10:** Gate must pass before push: `node scripts/check-all.mjs L2`
- **INV-11:** Full matrix testing — every generated template/artifact must be tested across all supported stacks (TS, Java, Rust, Go, Python) × tools (Claude, Codex, Cursor, Copilot) × governance levels (L1, L2, L3). No milestone completion without matrix coverage.
- **INV-13:** Self-hosted runner for Linux CI — all GitHub Actions Linux jobs (arbiter's own CI and the generated `ci.yml.ejs` template) must use `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}`. Do not hardcode `ubuntu-latest`. Override via repo variable `CI_BUILD_RUNNER_LABEL` when needed. Mirrors haben INV-11 (see [ADR-023](docs/ADR/023-self-hosted-ci-runner.md)).

---

## Coding Standards

### TypeScript

- Strict mode always on (`"strict": true` in tsconfig)
- No `any` — use `unknown` and narrow, or create proper types
- Prefer `const` over `let`, never `var`
- Async/await over callbacks or raw Promises
- Named exports preferred over default exports
- File naming: `kebab-case.ts`

---

## Testing Policy

### L2 (Standard)

- Unit tests: 85% coverage minimum
- Integration tests for all external boundaries (database, APIs)
- No mocking of internal modules — only boundary mocks
- TDD preferred: test first, then implement

---

## Commit Convention

```
type(scope): summary

Types: feat, fix, refactor, test, docs, ci, chore, perf
Scope: optional — module or area affected
Summary: imperative, lowercase, ≤ 72 chars
```

Examples:

- `feat(auth): add OAuth2 token refresh`
- `fix(#123): resolve null pointer in payment flow`
- `test: add integration tests for user registration`

---

## Branch Strategy

- Main branch: `main` — protected, requires PR + passing CI
- Task branches: `task/#NNN-short-description`
- No direct commits to `main`

---

## Gate System

```
L1 (fast, pre-commit):    npm run lint
                          echo &#34;no formatter configured&#34;
                          npm run test

L2 (full, pre-push):      L1 + coverage + audit + integration tests

L3 (deep, nightly/CI):    L2 + E2E + static analysis + evidence
```

Run locally:

```bash
node scripts/check-all.mjs L1   # before commit
node scripts/check-all.mjs L2   # before push
```

---

## Authoring — Task Workflow

Use `arbiter worktree open <task-id> [slug]` (alias: `arbiter wt open`) to start a task
branch. This command creates a sibling worktree (never nested), symlinks local-only files
(`.claude/settings.local.json`, `.env`), and prints the `cd` path. It is Claude-safe by
default — it never spawns GUI terminals.

Use `arbiter worktree close <task-id>` to tear down after merging. The command verifies
the branch is merged into `origin/main` before removing the worktree.

---

## Multi-Agent Tool Extensions

This project uses AGENTS.md as the canonical source. Tool-specific files add only what each tool uniquely needs:

| File                | Tool         | Purpose                                        |
| ------------------- | ------------ | ---------------------------------------------- |
| `.claude/CLAUDE.md` | Claude Code  | Hook configuration, sub-agents, slash commands |
| `.agents/CODEX.md`  | OpenAI Codex | Plan JSON schema, execution router             |

When using Claude Code: read `.claude/CLAUDE.md` for Claude-specific configuration.
When using Codex: read `.agents/CODEX.md` for Codex-specific configuration.
All governance rules are in **this file**.
