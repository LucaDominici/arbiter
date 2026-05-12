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
- **INV-03:** Layer boundaries enforced — domain code must not import from infrastructure layers
- **INV-04:** No `any` type in TypeScript — use `unknown` and narrow, or create proper types
- **INV-05:** Cyclomatic complexity ≤ 15 (ESLint `complexity` rule)
- **INV-06:** No unused exports (Knip dead code analysis, zero findings)

### Tier 2: Data Integrity

- **INV-07:** Schema changes via versioned migrations only — no manual DDL
- **INV-08:** Input validation at system boundaries
- **INV-09:** Audit trail for mutable entities
- **INV-10:** Soft delete preferred over hard delete
- **INV-34:** Integration tests must use real database (L2+)

### Tier 3: Security & Compliance

- **INV-11:** No secrets in source code
- **INV-12:** No PII in code, tests, or logs
- **INV-13:** Dependencies scanned for known vulnerabilities
- **INV-14:** No dynamic code execution with untrusted input — no `eval`/`exec`/shell with user data
- **INV-15:** Authentication required at every entry point — default-deny, explicit ADR to opt out

### Tier 4: Operational Excellence

- **INV-16:** No `console.log/warn/error` in production code — use structured logger
- **INV-17:** Unhandled Promise rejections forbidden — always `.catch()` or `await` in `try/catch`
- **INV-18:** No hardcoded environment values
- **INV-19:** Resilient external calls — circuit breaker or retry required
- **INV-20:** Health and readiness endpoints required for deployed services
- **INV-35:** Contract testing enforced when contractType is active
- **INV-40:** BDD scenarios with `@ignore` tag are HARD-fail
- **INV-41:** Message-queue contract tests must call Schema Registry testCompatibility
- **INV-42:** Pact broker glue must be env-gated — no silent runs against default URL
- **INV-43:** OpenAPI exporter must run before diff; missing reference is HARD-fail
- **INV-44:** SpotBugs security-category bugs MUST NEVER be suppressed or baselined (Java) — hard-block list: SQL_INJECTION, XSS, COMMAND_INJECTION, XXE, LDAP_INJECTION, HARD_CODE_PASSWORD
- **INV-29:** No MockMvc — use RestAssured for Java integration tests (Java)
- **INV-30:** Mutation testing required — PIT/pitest for Java projects (L2+)

### Tier 5: Governance

- **INV-21:** Every TODO comment must reference a task ID: `TODO(#NNN)`
- **INV-22:** Branch naming: `task/#NNN-description`
- **INV-23:** No direct commits to `main` — all changes via task branches + PR
- **INV-24:** Gate must pass before commit: `node scripts/check-all.mjs L1`
- **INV-25:** Gate must pass before push: `node scripts/check-all.mjs L2`
- **INV-26:** TDD mandatory — test first, then implement
- **INV-31:** Suppressions (file-based AND inline arbiter-suppress directives) must have mandatory expiry, reason, and owner
- **INV-32:** Every 'proven' language must have a nightly real-project fixture
- **INV-36:** Hook hardness manifest — every hook must declare intent; HARD hooks must empirically block
- **INV-37:** Generated githooks
- **INV-38:** Phase-tracked lifecycle enforcement
- **INV-39:** Hook templates require empirical fire-tests in `__tests__/hooks/empirical/`
- **INV-27:** Evidence artifacts must be generated for all L3 gate runs (CI evidence collection step)
- **INV-28:** SSOT documents must not contradict — run drift check before L3 merge
- **INV-33:** L3 merges require valid evidence bundle with `obs_gate == PASS`
- **INV-45:** Self-dogfood check — every `.ejs` template must render to match its materialized `.claude/` file (run `node scripts/check-self-dogfood.mjs` at L2)
- **INV-46:** Anti-bloat enforcement — new `src/` files require a valid Existing Code Survey in the plan (`pre-edit-plan-anchor.mjs` hard-blocks, exit 2); L1: `check-bloat-ratchet.mjs` (file/LOC ceiling); L2: `jscpd` (duplication ≤5%); bypasses: `ARBITER_PLAN_BYPASS=1`, `ALLOW_BLOAT=1`
- **INV-47:** Exit-code universal contract — every Arbiter-emitted script must exit `0=PASS / 1=FAIL / 2=ERROR`; L1: `check-exit-code-contract.mjs` blocks any `process.exit(N)` where N ∉ {0,1,2}; L2: `self-validation.mjs` A/B/C drill proves each gate distinguishes all three codes

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
