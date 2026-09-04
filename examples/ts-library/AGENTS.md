# ts-library-fixture — AGENTS.md

> **Canonical governance for AI coding agents.**
> All tools read this file. Tool-specific extensions: `.claude/CLAUDE.md`, `.agents/CODEX.md`
>
> Standard: [AGENTS.md — AAIF / Linux Foundation](https://agents.md/)

---

## Project

| Fact | Value |
|------|-------|
| **What** | ts-library-fixture project |
| **Stack** | typescript |
| **Build** | `npm run build` |
| **Test** | `npm run test` |
| **Gate** | `node scripts/check-all.mjs` (mandatory before commit) |

---

## Authority Hierarchy

When documents conflict, higher level wins. No debate.

```
Level 1:  AGENTS.md — invariants + governance (this file)
Level 2:  Architecture docs (docs/SYSTEM/ARCHITECTURE.md, PROJECT_STATUS.md)
Level 2.5: DECISION_REGISTRY.md — blocked project decisions (D-NN, #2036)
Level 3:  Source code + tests — implementation truth
```

Blocked decisions live in `DECISION_REGISTRY.md` (D-NN — one rule lives in ONE
registry; a decision that matures into a permanent rule promotes to a PROJ-NN
invariant). The decision-registry gate fails on orphan D-NN decisions.

---

## Iron Laws

Behavioral protocol rules that sit above the invariant catalog — process discipline,
not a checkable gate. Violation protocol: **STOP → REFUSE → cite the law**.

### Worktree Isolation Is Mandatory For Parallel Agents

Concurrent agents must each work in an isolated git worktree. Shared-tree parallel
editing — two or more agents writing into the same working tree at once — is
prohibited: git index state, lockfiles, and in-flight diffs corrupt under
concurrent writers, with no clean recovery path. One agent, one worktree, one
branch.

### Complete Means Merged To Main

No task, PR, or issue may be reported complete before its PR is merged green on
`main`. Open is not done. A PR is owned until merged: follow it through CI and fix
each red by root cause (read the failing job's log, fix the underlying cause,
push, re-verify), repeated until every check passes and it merges. Handing back or
abandoning a red PR, or reporting a task complete while its PR is still open, is a
process violation.

### Root-Cause-First After Any Failure

On an error, stop the patch-spiral. Do not attempt a second fix before performing
structural analysis: read the actual failure, trace it to its origin, and only
then apply the fix that addresses the root cause. A patch applied without
diagnosis is a guess, not a fix, and tends to compound rather than resolve.

### Verification-Before-Victory

Run targeted local verification — an end-to-end exercise of the changed behavior,
not just a green typecheck or unit-test run — before every push. This is the
dominant agent failure mode: of observed real agent errors, the majority (5 of 8)
were claims of success without the change ever having been exercised. Review
layers do not prevent this; only verification does.

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
- **INV-99:** deployTarget must be a known cloud or "none"
- **INV-100:** collaborationMode must be set in arbiter.json
- **INV-101:** exact-SHA non-force landing for evidence-bearing changes

### Tier 3: Security & Compliance

- **INV-11:** No secrets in source code
- **INV-12:** No PII in code, tests, or logs

### Tier 5: Governance

- **INV-21:** Every TODO comment must reference a task ID: `TODO(#NNN)`
- **INV-22:** Branch naming: `task/#NNN-description`
- **INV-23:** No direct commits to `main` — all changes via task branches + PR
- **INV-24:** Gate must pass before commit: `node scripts/check-all.mjs L1`
- **INV-25:** Gate must pass before push: `node scripts/check-all.mjs L2`
- **INV-31:** Suppressions must have mandatory expiry
- **INV-37:** Generated githooks
- **INV-38:** Phase-tracked lifecycle enforcement
- **INV-53:** Exit-code universal contract — every Arbiter-emitted script exits 0=PASS / 1=FAIL / 2=ERROR
- **INV-54:** SSOT core set integrity — all listed files must exist
- **INV-55:** Doc-links integrity — all markdown links must resolve
- **INV-57:** Canonical-paths integrity — all redirect targets must exist
- **INV-58:** Node version SSOT — .nvmrc is canonical; all CI jobs use node-version-file
- **INV-59:** Gate result parity — local L1 static gates must produce the same pass/fail pattern as CI
- **INV-115:** Free-text governance prohibitions must resolve to a verified enforcer, live scan, or explicit triage
- **INV-118:** Anti-proforma test gate — every test must carry a real assertion
- **INV-129:** No tracked data/state files or compiled binaries in the index
- **INV-144:** The architecture document is a filled structure, not a surviving skeleton
- **INV-145:** Adversarial review closes only when nothing above low severity survives
- **INV-147:** A cited source is quotable, and the quotation checks out

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

### L1 (Minimal)

- Unit tests for all business logic
- No mocking of internal modules (only external boundaries)
- Coverage target: 70%

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
L1 (fast, pre-commit):    echo &#34;no lint configured&#34;
                          npx prettier --check .
                          npm run test

L2 (full, pre-push):      L1 + coverage + audit + integration tests

L3 (deep, nightly/CI):    L2 + E2E + mutation testing

L4 (compliance):          L3 + evidence harness + STRIDE risk + TRACK_ROUTER
```

Run locally:
```bash
node scripts/check-all.mjs L1   # before commit
node scripts/check-all.mjs L2   # before push
```

---

## Enforcement Chain

Changes pass through five enforcement layers:

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| Edit-time | Claude Code hooks (`.claude/hooks/`) | Claude Code edits only |
| Pre-commit | `.githooks/pre-commit` — runs L1 gate | All editors (`git commit`) |
| Pre-push | `.githooks/pre-push` — runs L2 gate | All pushes |
| CI | GitHub Actions / equivalent | All PRs |
| Branch protection | See ADR-007 | Force-push, direct merge |

Install hooks: `git config core.hooksPath .githooks` (auto-applied via `npm install` — see `package.json` `prepare` script).
Bypass surface: only `git commit --no-verify` (documented, audited at PR review).

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
