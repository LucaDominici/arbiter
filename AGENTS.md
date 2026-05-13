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
- **INV-03:** Architecture boundary enforcement
- **INV-04:** Language-specific type safety
- **INV-05:** Complexity limits enforced
- **INV-06:** No unused or dead code
- **INV-46:** Anti-bloat enforcement — Survey gate + duplication detector + LOC ratchet

### Tier 2: Data Integrity

- **INV-07:** Schema changes via versioned migrations only — no manual DDL
- **INV-08:** Input validation at system boundaries
- **INV-09:** Audit trail for mutable entities
- **INV-10:** Soft delete preferred over hard delete
- **INV-33:** L3 merges require valid evidence with obs_gate == PASS
- **INV-34:** Integration tests must use real database (L2+)

### Tier 3: Security & Compliance

- **INV-11:** No secrets in source code
- **INV-12:** No PII in code, tests, or logs
- **INV-13:** Dependencies scanned for known vulnerabilities
- **INV-14:** No dynamic code execution with untrusted input
- **INV-15:** Authentication required at every entry point

### Tier 4: Operational Excellence

- **INV-16:** Structured logging only — no raw print statements in production
- **INV-17:** Explicit error handling — panics and unhandled errors are forbidden
- **INV-18:** No hardcoded environment values
- **INV-19:** Resilient external calls — circuit breaker or retry required
- **INV-20:** Health and readiness endpoints required for deployed services
- **INV-35:** Contract testing enforced when contractType is active
- **INV-40:** BDD scenarios with @ignore tag are HARD-fail
- **INV-41:** Message-queue contract tests must call Schema Registry testCompatibility
- **INV-42:** Pact broker glue must be env-gated; no silent runs against default URL
- **INV-43:** OpenAPI exporter must run before diff; missing reference is HARD-fail
- **INV-44:** SpotBugs security-category bugs MUST NEVER be suppressed or baselined

### Tier 5: Governance

- **INV-21:** Every TODO comment must reference a task ID: `TODO(#NNN)`
- **INV-22:** Branch naming: `task/#NNN-description`
- **INV-23:** No direct commits to `main` — all changes via task branches + PR
- **INV-24:** Gate must pass before commit: `node scripts/check-all.mjs L1`
- **INV-25:** Gate must pass before push: `node scripts/check-all.mjs L2`
- **INV-26:** TDD mandatory — test first, then implement
- **INV-27:** Evidence artifacts must be generated for all gate runs
- **INV-28:** SSOT documents must not contradict — run drift check before merge
- **INV-29:** No MockMvc — use RestAssured for integration tests (Java)
- **INV-30:** Mutation testing required — PIT/pitest (Java, L2+)
- **INV-31:** Suppressions must have mandatory expiry
- **INV-32:** Every 'proven' language must have a nightly real-project fixture
- **INV-36:** Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block
- **INV-37:** Generated githooks
- **INV-38:** Phase-tracked lifecycle enforcement
- **INV-39:** Hook templates require empirical fire-tests
- **INV-45:** Self-dogfood check — every EJS template must render to match its materialized .claude/ file
- **INV-47:** Matrix proven cell requires a gate invocation in check-all.mjs.ejs
- **INV-48:** EJS template render-test coverage must not regress
- **INV-49:** Every generator in src/generators/ must have a unit test
- **INV-50:** Every command in src/commands/ must have a test
- **INV-51:** Every catalog invariant must appear in AGENTS.md §Invariants
- **INV-52:** Catalog enforcement script citations must be wired in check-all.mjs
- **INV-53:** Exit-code universal contract — every Arbiter-emitted script exits 0=PASS / 1=FAIL / 2=ERROR
- **INV-54:** SSOT core set integrity — all listed files must exist
- **INV-55:** Doc-links integrity — all markdown links must resolve
- **INV-56:** Knowledge-map freshness — line counts must not drift beyond tolerance
- **INV-57:** Canonical-paths integrity — all redirect targets must exist
- **INV-58:** Node version SSOT — .nvmrc is canonical; all CI jobs use node-version-file
- **INV-59:** Gate result parity — local L1 static gates must produce the same pass/fail pattern as CI
- **INV-60:** Release binary size capped at archetype default
- **INV-61:** a11y critical violations are HARD-fail at L2

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
                          npx prettier --check .
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

## Enforcement Chain

Changes pass through five enforcement layers:

| Layer             | Mechanism                             | Coverage                   |
| ----------------- | ------------------------------------- | -------------------------- |
| Edit-time         | Claude Code hooks (`.claude/hooks/`)  | Claude Code edits only     |
| Pre-commit        | `.githooks/pre-commit` — runs L1 gate | All editors (`git commit`) |
| Pre-push          | `.githooks/pre-push` — runs L2 gate   | All pushes                 |
| CI                | GitHub Actions / equivalent           | All PRs                    |
| Branch protection | See ADR-007                           | Force-push, direct merge   |

Install hooks: `git config core.hooksPath .githooks` (auto-applied via `npm install` — see `package.json` `prepare` script).
Bypass surface: only `git commit --no-verify` (documented, audited at PR review).

---

## Tech Debt Gates

Enforced at L2+ (automated, runs in CI and locally via `node scripts/check-all.mjs L2`):

| Check         | Tool                     | Threshold           |
| ------------- | ------------------------ | ------------------- |
| Coverage      | vitest / jest            | 80% lines           |
| Complexity    | ESLint `complexity` rule | max 15              |
| Dead Code     | Knip                     | zero unused exports |
| Circular Deps | madge                    | zero cycles         |

---

## Debt Ratchet

Proactive debt regression prevention. Baseline metrics stored in `debt-baseline.json` (commit this file).

**Commands:**

- `node scripts/capture-debt-baseline.mjs` — Capture current metrics as baseline
- `node scripts/capture-debt-baseline.mjs --update` — Tighten baseline (only accepts improvements, never loosens)
- `node scripts/debt-report.mjs` — Print current vs baseline comparison report
- `node scripts/debt-report.mjs --gate` — Fail if any metric regressed (used in L2 gate)

**Tracked:** coverage, complexity violations, dead code count, TODO count

**Rule:** Never manually edit `debt-baseline.json` to loosen metrics — that defeats the ratchet. Only run `--update` after genuine improvements.

---

## Security Scanning (INV-11/12/13)

Security gates run as L2+ hard requirements. PII scan is HARD (no grace period) and runs before all other gates.

| Scanner           | Tool         | Gate Level         | Trigger                                                                   |
| ----------------- | ------------ | ------------------ | ------------------------------------------------------------------------- |
| Secrets detection | gitleaks     | L2 HARD            | `gitleaks detect --source . --baseline-path suppressions/.gitleaksignore` |
| PII scan          | pii-scan.mjs | L2 HARD (no grace) | `node scripts/pii-scan.mjs`                                               |
| Dep audit         | npm audit    | L2 HARD            | `npm audit --audit-level=high`                                            |

**Suppression files** (user-edited, not overwritten):

- `suppressions/.gitleaksignore` — allowlisted gitleaks findings
- `suppressions/pii-allowlist.json` — allowlisted PII patterns (format: `[{"pattern": "...", "reason": "..."}]`)

**Claude hook**: `check-no-pii.mjs` (PostToolUse, Edit|Write) blocks PII from being written to source files.

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
