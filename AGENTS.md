# arbiter — AGENTS.md

> **Canonical governance for AI coding agents.**
> All tools read this file. Tool-specific extensions: `.claude/CLAUDE.md`, `.agents/CODEX.md`
>
> Standard: [AGENTS.md — AAIF / Linux Foundation](https://agents.md/)

---

## Project

| Fact | Value |
|------|-------|
| **What** | arbiter project |
| **Stack** | typescript |
| **Build** | `npm run build` |
| **Test** | `npm run test` |
| **Gate** | `./scripts/check-all.sh` (mandatory before commit) |

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

### Tier 2: Code Quality

- **INV-04:** No `any` type in TypeScript (enforced by hook + CI)
- **INV-05:** No unused exports (dead code elimination enforced by CI)
- **INV-06:** Every TODO comment must reference a task ID: `TODO(#NNN)`

### Tier 3: Process

- **INV-07:** Branch naming: `task/#NNN-description`
- **INV-08:** No direct commits to `main` — all changes via task branches + PR
- **INV-09:** Gate must pass before commit: `./scripts/check-all.sh L1`
- **INV-10:** Gate must pass before push: `./scripts/check-all.sh L2`

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

- Unit tests: 80% coverage minimum
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
./scripts/check-all.sh L1   # before commit
./scripts/check-all.sh L2   # before push
```

---

## Multi-Agent Tool Extensions

This project uses AGENTS.md as the canonical source. Tool-specific files add only what each tool uniquely needs:

| File | Tool | Purpose |
|------|------|---------|
| `.claude/CLAUDE.md` | Claude Code | Hook configuration, sub-agents, slash commands |
| `.agents/CODEX.md` | OpenAI Codex | Plan JSON schema, execution router |

When using Claude Code: read `.claude/CLAUDE.md` for Claude-specific configuration.
When using Codex: read `.agents/CODEX.md` for Codex-specific configuration.
All governance rules are in **this file**.
