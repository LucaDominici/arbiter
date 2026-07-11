# go-library — AGENTS.md

> **Canonical governance for AI coding agents.**
> All tools read this file. Tool-specific extensions: `.claude/CLAUDE.md`, `.agents/CODEX.md`
>
> Standard: [AGENTS.md — AAIF / Linux Foundation](https://agents.md/)

---

## Project

| Fact | Value |
|------|-------|
| **What** | go-library project |
| **Stack** | go |
| **Build** | `go build ./...` |
| **Test** | `go test ./...` |
| **Gate** | `node scripts/check-all.mjs` (mandatory before commit) |

---

## Authority Hierarchy

When documents conflict, higher level wins. No debate.

```
Level 1:  AGENTS.md — invariants + governance (this file)
Level 2:  Architecture docs (docs/SYSTEM/ARCHITECTURE.md, PROJECT_STATUS.md)
Level 3:  Source code + tests — implementation truth
```

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
- **INV-03:** Package boundaries enforced — minimize `internal/` escapes and cross-layer imports
- **INV-04:** Explicit error handling required — no silenced errors with blank identifier
- **INV-05:** Cyclomatic complexity ≤ 15 (`gocyclo` via golangci-lint)
- **INV-06:** No unused code (`deadcode,unused` via golangci-lint, zero findings)
- **INV-99:** deployTarget must be a known cloud or "none"
- **INV-100:** collaborationMode must be set in arbiter.json
- **INV-101:** ff-only merge is the only allowed merge method

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

---

## Coding Standards

### Go

- All exported functions must have documentation comments
- Error handling: check every returned error — no `_ = err` patterns
- Use `gofmt` for formatting (enforced by CI)
- Use `golangci-lint` with project-level config
- Prefer table-driven tests
- File naming: `snake_case.go`

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
L1 (fast, pre-commit):    golangci-lint run
                          gofmt -l .
                          go test ./...

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

Install hooks: `git config core.hooksPath .githooks` (or run `./scripts/setup-hooks.sh`).
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


---

## Integrations

Installed Claude Code skills detected at init time. These replace the corresponding built-in arbiter skill generators — do not regenerate the listed files.

| Skill ID | Owner | Role | Replaces |
|----------|-------|------|---------|
| `document-skills:algorithmic-art` | document-skills | — | — |
| `document-skills:brand-guidelines` | document-skills | — | — |
| `document-skills:canvas-design` | document-skills | — | — |
| `document-skills:claude-api` | document-skills | — | — |
| `document-skills:doc-coauthoring` | document-skills | — | — |
| `document-skills:docx` | document-skills | — | — |
| `document-skills:frontend-design` | document-skills | — | — |
| `document-skills:internal-comms` | document-skills | — | — |
| `document-skills:mcp-builder` | document-skills | — | — |
| `document-skills:pdf` | document-skills | — | — |
| `document-skills:pptx` | document-skills | — | — |
| `document-skills:skill-creator` | document-skills | — | — |
| `document-skills:slack-gif-creator` | document-skills | — | — |
| `document-skills:theme-factory` | document-skills | — | — |
| `document-skills:web-artifacts-builder` | document-skills | — | — |
| `document-skills:webapp-testing` | document-skills | — | — |
| `document-skills:xlsx` | document-skills | — | — |
| `document-skills:template-skill` | document-skills | — | — |
| `caveman:caveman` | caveman | — | — |
| `caveman:caveman-compress` | caveman | — | — |
| `caveman:caveman-commit` | caveman | — | — |
| `caveman:caveman-help` | caveman | — | — |
| `caveman:caveman-review` | caveman | — | — |
| `caveman:compress` | caveman | — | — |
| `frontend-design:frontend-design` | frontend-design | — | — |
| `hookify:Writing Hookify Rules` | hookify | — | — |
| `claude-code-setup:claude-automation-recommender` | claude-code-setup | — | — |
| `claude-md-management:claude-md-improver` | claude-md-management | — | — |
| `hookify:writing-hookify-rules` | hookify | — | — |
| `skill-creator:skill-creator` | skill-creator | — | — |
| `superpowers:brainstorming` | superpowers | — | — |
| `superpowers:dispatching-parallel-agents` | superpowers | — | — |
| `superpowers:executing-plans` | superpowers | — | — |
| `superpowers:finishing-a-development-branch` | superpowers | — | — |
| `superpowers:receiving-code-review` | superpowers | — | — |
| `superpowers:requesting-code-review` | superpowers | — | — |
| `superpowers:subagent-driven-development` | superpowers | — | — |
| `superpowers:systematic-debugging` | superpowers | — | — |
| `superpowers:test-driven-development` | superpowers | — | — |
| `superpowers:using-git-worktrees` | superpowers | — | — |
| `superpowers:using-superpowers` | superpowers | — | — |
| `superpowers:verification-before-completion` | superpowers | — | — |
| `superpowers:writing-plans` | superpowers | — | — |
| `superpowers:writing-skills` | superpowers | — | — |
| `andrej-karpathy-skills:karpathy-guidelines` | andrej-karpathy-skills | — | — |
| `be47dfbdabff:ln-001-push-all` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-002-session-analyzer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-010-dev-environment-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-011-agent-installer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-012-mcp-configurator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-013-config-syncer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-014-agent-instructions-manager` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-015-hex-line-uninstaller` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-020-codegraph` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-100-documents-pipeline` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-1000-pipeline-orchestrator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-110-project-docs-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-111-root-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-112-project-core-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-113-backend-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-114-frontend-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-115-devops-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-120-reference-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-130-tasks-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-140-test-docs-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-160-docs-skill-extractor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-161-skill-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-162-skill-reviewer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-200-scope-decomposer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-201-opportunity-discoverer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-210-epic-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-220-story-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-221-story-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-222-story-replanner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-230-story-prioritizer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-300-task-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-301-task-creator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-302-task-replanner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-310-multi-agent-validator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-311-review-research-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-312-review-findings-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-313-review-docs-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-314-review-repair-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-315-review-merge-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-316-review-refinement-worker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-400-story-executor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-401-task-executor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-402-task-reviewer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-403-task-rework` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-404-test-executor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-500-story-quality-gate` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-510-quality-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-511-code-quality-checker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-512-tech-debt-cleaner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-513-regression-checker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-514-test-log-analyzer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-520-test-planner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-521-test-researcher` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-522-manual-tester` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-523-auto-test-planner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-610-docs-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-611-docs-structure-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-612-semantic-content-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-613-code-comments-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-614-docs-fact-checker` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-620-codebase-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-621-security-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-622-build-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-623-code-principles-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-624-code-quality-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-625-dependencies-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-626-dead-code-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-627-observability-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-628-concurrency-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-629-lifecycle-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-630-test-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-631-test-business-logic-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-632-test-e2e-priority-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-633-test-value-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-634-test-coverage-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-635-test-isolation-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-636-manual-test-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-637-test-structure-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-640-pattern-evolution-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-641-pattern-analyzer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-642-layer-boundary-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-643-api-contract-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-644-dependency-graph-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-645-open-source-replacer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-646-project-structure-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-647-env-config-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-650-persistence-performance-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-651-query-efficiency-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-652-transaction-correctness-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-653-runtime-performance-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-654-resource-lifecycle-auditor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-700-project-bootstrap` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-720-structure-migrator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-721-frontend-restructure` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-722-backend-generator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-723-seed-data-generator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-724-artifact-cleaner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-730-devops-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-731-docker-generator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-732-cicd-generator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-733-env-configurator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-740-quality-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-741-linter-configurator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-742-precommit-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-743-test-infrastructure` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-760-security-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-761-secret-scanner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-770-crosscutting-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-771-logging-configurator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-772-error-handler-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-773-cors-configurator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-774-healthcheck-setup` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-775-api-docs-generator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-780-bootstrap-verifier` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-781-build-verifier` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-782-test-runner` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-783-container-launcher` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-810-performance-optimizer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-811-performance-profiler` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-812-optimization-researcher` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-813-optimization-plan-validator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-814-optimization-executor` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-820-dependency-optimization-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-821-npm-upgrader` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-822-nuget-upgrader` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-823-pip-upgrader` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-830-code-modernization-coordinator` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-831-oss-replacer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-832-bundle-optimizer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-840-benchmark-compare` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-910-community-engagement` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-911-github-triager` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-912-community-announcer` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-913-community-debater` | be47dfbdabff | — | — |
| `be47dfbdabff:ln-914-community-responder` | be47dfbdabff | — | — |
| `agile-workflow:ln-001-standards-researcher` | agile-workflow | — | — |
| `agile-workflow:ln-002-best-practices-researcher` | agile-workflow | — | — |
| `agile-workflow:ln-003-push-all` | agile-workflow | — | — |
| `agile-workflow:ln-004-agent-config-sync` | agile-workflow | — | — |
| `agile-workflow:ln-005-environment-scanner` | agile-workflow | — | — |
| `agile-workflow:ln-100-documents-pipeline` | agile-workflow | — | — |
| `agile-workflow:ln-1000-pipeline-orchestrator` | agile-workflow | — | — |
| `agile-workflow:ln-110-project-docs-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-111-root-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-112-project-core-creator` | agile-workflow | — | — |
| `agile-workflow:ln-113-backend-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-114-frontend-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-115-devops-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-120-reference-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-130-tasks-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-140-test-docs-creator` | agile-workflow | — | — |
| `agile-workflow:ln-150-presentation-creator` | agile-workflow | — | — |
| `agile-workflow:ln-160-docs-skill-extractor` | agile-workflow | — | — |
| `agile-workflow:ln-161-skill-creator` | agile-workflow | — | — |
| `agile-workflow:ln-162-skill-reviewer` | agile-workflow | — | — |
| `agile-workflow:ln-200-scope-decomposer` | agile-workflow | — | — |
| `agile-workflow:ln-201-opportunity-discoverer` | agile-workflow | — | — |
| `agile-workflow:ln-210-epic-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-220-story-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-221-story-creator` | agile-workflow | — | — |
| `agile-workflow:ln-222-story-replanner` | agile-workflow | — | — |
| `agile-workflow:ln-230-story-prioritizer` | agile-workflow | — | — |
| `agile-workflow:ln-300-task-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-301-task-creator` | agile-workflow | — | — |
| `agile-workflow:ln-302-task-replanner` | agile-workflow | — | — |
| `agile-workflow:ln-310-multi-agent-validator` | agile-workflow | — | — |
| `agile-workflow:ln-400-story-executor` | agile-workflow | — | — |
| `agile-workflow:ln-401-task-executor` | agile-workflow | — | — |
| `agile-workflow:ln-402-task-reviewer` | agile-workflow | — | — |
| `agile-workflow:ln-403-task-rework` | agile-workflow | — | — |
| `agile-workflow:ln-404-test-executor` | agile-workflow | — | — |
| `agile-workflow:ln-500-story-quality-gate` | agile-workflow | — | — |
| `agile-workflow:ln-510-quality-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-511-code-quality-checker` | agile-workflow | — | — |
| `agile-workflow:ln-512-tech-debt-cleaner` | agile-workflow | — | — |
| `agile-workflow:ln-513-regression-checker` | agile-workflow | — | — |
| `agile-workflow:ln-514-test-log-analyzer` | agile-workflow | — | — |
| `agile-workflow:ln-520-test-planner` | agile-workflow | — | — |
| `agile-workflow:ln-521-test-researcher` | agile-workflow | — | — |
| `agile-workflow:ln-522-manual-tester` | agile-workflow | — | — |
| `agile-workflow:ln-523-auto-test-planner` | agile-workflow | — | — |
| `agile-workflow:ln-610-docs-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-611-docs-structure-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-612-semantic-content-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-613-code-comments-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-614-docs-fact-checker` | agile-workflow | — | — |
| `agile-workflow:ln-620-codebase-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-621-security-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-622-build-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-623-code-principles-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-624-code-quality-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-625-dependencies-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-626-dead-code-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-627-observability-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-628-concurrency-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-629-lifecycle-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-630-test-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-631-test-business-logic-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-632-test-e2e-priority-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-633-test-value-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-634-test-coverage-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-635-test-isolation-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-636-manual-test-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-637-test-structure-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-640-pattern-evolution-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-641-pattern-analyzer` | agile-workflow | — | — |
| `agile-workflow:ln-642-layer-boundary-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-643-api-contract-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-644-dependency-graph-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-645-open-source-replacer` | agile-workflow | — | — |
| `agile-workflow:ln-646-project-structure-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-647-env-config-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-650-persistence-performance-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-651-query-efficiency-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-652-transaction-correctness-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-653-runtime-performance-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-654-resource-lifecycle-auditor` | agile-workflow | — | — |
| `agile-workflow:ln-700-project-bootstrap` | agile-workflow | — | — |
| `agile-workflow:ln-720-structure-migrator` | agile-workflow | — | — |
| `agile-workflow:ln-721-frontend-restructure` | agile-workflow | — | — |
| `agile-workflow:ln-722-backend-generator` | agile-workflow | — | — |
| `agile-workflow:ln-723-seed-data-generator` | agile-workflow | — | — |
| `agile-workflow:ln-724-artifact-cleaner` | agile-workflow | — | — |
| `agile-workflow:ln-730-devops-setup` | agile-workflow | — | — |
| `agile-workflow:ln-731-docker-generator` | agile-workflow | — | — |
| `agile-workflow:ln-732-cicd-generator` | agile-workflow | — | — |
| `agile-workflow:ln-733-env-configurator` | agile-workflow | — | — |
| `agile-workflow:ln-740-quality-setup` | agile-workflow | — | — |
| `agile-workflow:ln-741-linter-configurator` | agile-workflow | — | — |
| `agile-workflow:ln-742-precommit-setup` | agile-workflow | — | — |
| `agile-workflow:ln-743-test-infrastructure` | agile-workflow | — | — |
| `agile-workflow:ln-760-security-setup` | agile-workflow | — | — |
| `agile-workflow:ln-761-secret-scanner` | agile-workflow | — | — |
| `agile-workflow:ln-770-crosscutting-setup` | agile-workflow | — | — |
| `agile-workflow:ln-771-logging-configurator` | agile-workflow | — | — |
| `agile-workflow:ln-772-error-handler-setup` | agile-workflow | — | — |
| `agile-workflow:ln-773-cors-configurator` | agile-workflow | — | — |
| `agile-workflow:ln-774-healthcheck-setup` | agile-workflow | — | — |
| `agile-workflow:ln-775-api-docs-generator` | agile-workflow | — | — |
| `agile-workflow:ln-780-bootstrap-verifier` | agile-workflow | — | — |
| `agile-workflow:ln-781-build-verifier` | agile-workflow | — | — |
| `agile-workflow:ln-782-test-runner` | agile-workflow | — | — |
| `agile-workflow:ln-783-container-launcher` | agile-workflow | — | — |
| `agile-workflow:ln-810-performance-optimizer` | agile-workflow | — | — |
| `agile-workflow:ln-811-performance-profiler` | agile-workflow | — | — |
| `agile-workflow:ln-812-optimization-researcher` | agile-workflow | — | — |
| `agile-workflow:ln-813-optimization-plan-validator` | agile-workflow | — | — |
| `agile-workflow:ln-814-optimization-executor` | agile-workflow | — | — |
| `agile-workflow:ln-820-dependency-optimization-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-821-npm-upgrader` | agile-workflow | — | — |
| `agile-workflow:ln-822-nuget-upgrader` | agile-workflow | — | — |
| `agile-workflow:ln-823-pip-upgrader` | agile-workflow | — | — |
| `agile-workflow:ln-830-code-modernization-coordinator` | agile-workflow | — | — |
| `agile-workflow:ln-831-oss-replacer` | agile-workflow | — | — |
| `agile-workflow:ln-832-bundle-optimizer` | agile-workflow | — | — |
| `agile-workflow:ln-910-community-engagement` | agile-workflow | — | — |
| `agile-workflow:ln-911-github-triager` | agile-workflow | — | — |
| `agile-workflow:ln-912-community-announcer` | agile-workflow | — | — |
| `agile-workflow:ln-913-community-debater` | agile-workflow | — | — |
| `agile-workflow:ln-914-community-responder` | agile-workflow | — | — |
| `codebase-audit-suite:ln-001-standards-researcher` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-002-best-practices-researcher` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-003-push-all` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-004-agent-config-sync` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-005-environment-scanner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-100-documents-pipeline` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-1000-pipeline-orchestrator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-110-project-docs-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-111-root-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-112-project-core-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-113-backend-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-114-frontend-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-115-devops-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-120-reference-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-130-tasks-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-140-test-docs-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-150-presentation-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-160-docs-skill-extractor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-161-skill-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-162-skill-reviewer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-200-scope-decomposer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-201-opportunity-discoverer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-210-epic-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-220-story-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-221-story-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-222-story-replanner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-230-story-prioritizer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-300-task-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-301-task-creator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-302-task-replanner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-310-multi-agent-validator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-400-story-executor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-401-task-executor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-402-task-reviewer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-403-task-rework` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-404-test-executor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-500-story-quality-gate` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-510-quality-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-511-code-quality-checker` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-512-tech-debt-cleaner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-513-regression-checker` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-514-test-log-analyzer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-520-test-planner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-521-test-researcher` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-522-manual-tester` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-523-auto-test-planner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-610-docs-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-611-docs-structure-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-612-semantic-content-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-613-code-comments-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-614-docs-fact-checker` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-620-codebase-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-621-security-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-622-build-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-623-code-principles-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-624-code-quality-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-625-dependencies-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-626-dead-code-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-627-observability-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-628-concurrency-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-629-lifecycle-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-630-test-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-631-test-business-logic-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-632-test-e2e-priority-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-633-test-value-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-634-test-coverage-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-635-test-isolation-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-636-manual-test-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-637-test-structure-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-640-pattern-evolution-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-641-pattern-analyzer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-642-layer-boundary-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-643-api-contract-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-644-dependency-graph-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-645-open-source-replacer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-646-project-structure-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-647-env-config-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-650-persistence-performance-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-651-query-efficiency-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-652-transaction-correctness-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-653-runtime-performance-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-654-resource-lifecycle-auditor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-700-project-bootstrap` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-720-structure-migrator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-721-frontend-restructure` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-722-backend-generator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-723-seed-data-generator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-724-artifact-cleaner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-730-devops-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-731-docker-generator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-732-cicd-generator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-733-env-configurator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-740-quality-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-741-linter-configurator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-742-precommit-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-743-test-infrastructure` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-760-security-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-761-secret-scanner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-770-crosscutting-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-771-logging-configurator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-772-error-handler-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-773-cors-configurator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-774-healthcheck-setup` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-775-api-docs-generator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-780-bootstrap-verifier` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-781-build-verifier` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-782-test-runner` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-783-container-launcher` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-810-performance-optimizer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-811-performance-profiler` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-812-optimization-researcher` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-813-optimization-plan-validator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-814-optimization-executor` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-820-dependency-optimization-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-821-npm-upgrader` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-822-nuget-upgrader` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-823-pip-upgrader` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-830-code-modernization-coordinator` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-831-oss-replacer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-832-bundle-optimizer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-910-community-engagement` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-911-github-triager` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-912-community-announcer` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-913-community-debater` | codebase-audit-suite | — | — |
| `codebase-audit-suite:ln-914-community-responder` | codebase-audit-suite | — | — |
| `community-engagement:ln-001-standards-researcher` | community-engagement | — | — |
| `community-engagement:ln-002-best-practices-researcher` | community-engagement | — | — |
| `community-engagement:ln-003-push-all` | community-engagement | — | — |
| `community-engagement:ln-004-agent-config-sync` | community-engagement | — | — |
| `community-engagement:ln-005-environment-scanner` | community-engagement | — | — |
| `community-engagement:ln-100-documents-pipeline` | community-engagement | — | — |
| `community-engagement:ln-1000-pipeline-orchestrator` | community-engagement | — | — |
| `community-engagement:ln-110-project-docs-coordinator` | community-engagement | — | — |
| `community-engagement:ln-111-root-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-112-project-core-creator` | community-engagement | — | — |
| `community-engagement:ln-113-backend-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-114-frontend-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-115-devops-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-120-reference-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-130-tasks-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-140-test-docs-creator` | community-engagement | — | — |
| `community-engagement:ln-150-presentation-creator` | community-engagement | — | — |
| `community-engagement:ln-160-docs-skill-extractor` | community-engagement | — | — |
| `community-engagement:ln-161-skill-creator` | community-engagement | — | — |
| `community-engagement:ln-162-skill-reviewer` | community-engagement | — | — |
| `community-engagement:ln-200-scope-decomposer` | community-engagement | — | — |
| `community-engagement:ln-201-opportunity-discoverer` | community-engagement | — | — |
| `community-engagement:ln-210-epic-coordinator` | community-engagement | — | — |
| `community-engagement:ln-220-story-coordinator` | community-engagement | — | — |
| `community-engagement:ln-221-story-creator` | community-engagement | — | — |
| `community-engagement:ln-222-story-replanner` | community-engagement | — | — |
| `community-engagement:ln-230-story-prioritizer` | community-engagement | — | — |
| `community-engagement:ln-300-task-coordinator` | community-engagement | — | — |
| `community-engagement:ln-301-task-creator` | community-engagement | — | — |
| `community-engagement:ln-302-task-replanner` | community-engagement | — | — |
| `community-engagement:ln-310-multi-agent-validator` | community-engagement | — | — |
| `community-engagement:ln-400-story-executor` | community-engagement | — | — |
| `community-engagement:ln-401-task-executor` | community-engagement | — | — |
| `community-engagement:ln-402-task-reviewer` | community-engagement | — | — |
| `community-engagement:ln-403-task-rework` | community-engagement | — | — |
| `community-engagement:ln-404-test-executor` | community-engagement | — | — |
| `community-engagement:ln-500-story-quality-gate` | community-engagement | — | — |
| `community-engagement:ln-510-quality-coordinator` | community-engagement | — | — |
| `community-engagement:ln-511-code-quality-checker` | community-engagement | — | — |
| `community-engagement:ln-512-tech-debt-cleaner` | community-engagement | — | — |
| `community-engagement:ln-513-regression-checker` | community-engagement | — | — |
| `community-engagement:ln-514-test-log-analyzer` | community-engagement | — | — |
| `community-engagement:ln-520-test-planner` | community-engagement | — | — |
| `community-engagement:ln-521-test-researcher` | community-engagement | — | — |
| `community-engagement:ln-522-manual-tester` | community-engagement | — | — |
| `community-engagement:ln-523-auto-test-planner` | community-engagement | — | — |
| `community-engagement:ln-610-docs-auditor` | community-engagement | — | — |
| `community-engagement:ln-611-docs-structure-auditor` | community-engagement | — | — |
| `community-engagement:ln-612-semantic-content-auditor` | community-engagement | — | — |
| `community-engagement:ln-613-code-comments-auditor` | community-engagement | — | — |
| `community-engagement:ln-614-docs-fact-checker` | community-engagement | — | — |
| `community-engagement:ln-620-codebase-auditor` | community-engagement | — | — |
| `community-engagement:ln-621-security-auditor` | community-engagement | — | — |
| `community-engagement:ln-622-build-auditor` | community-engagement | — | — |
| `community-engagement:ln-623-code-principles-auditor` | community-engagement | — | — |
| `community-engagement:ln-624-code-quality-auditor` | community-engagement | — | — |
| `community-engagement:ln-625-dependencies-auditor` | community-engagement | — | — |
| `community-engagement:ln-626-dead-code-auditor` | community-engagement | — | — |
| `community-engagement:ln-627-observability-auditor` | community-engagement | — | — |
| `community-engagement:ln-628-concurrency-auditor` | community-engagement | — | — |
| `community-engagement:ln-629-lifecycle-auditor` | community-engagement | — | — |
| `community-engagement:ln-630-test-auditor` | community-engagement | — | — |
| `community-engagement:ln-631-test-business-logic-auditor` | community-engagement | — | — |
| `community-engagement:ln-632-test-e2e-priority-auditor` | community-engagement | — | — |
| `community-engagement:ln-633-test-value-auditor` | community-engagement | — | — |
| `community-engagement:ln-634-test-coverage-auditor` | community-engagement | — | — |
| `community-engagement:ln-635-test-isolation-auditor` | community-engagement | — | — |
| `community-engagement:ln-636-manual-test-auditor` | community-engagement | — | — |
| `community-engagement:ln-637-test-structure-auditor` | community-engagement | — | — |
| `community-engagement:ln-640-pattern-evolution-auditor` | community-engagement | — | — |
| `community-engagement:ln-641-pattern-analyzer` | community-engagement | — | — |
| `community-engagement:ln-642-layer-boundary-auditor` | community-engagement | — | — |
| `community-engagement:ln-643-api-contract-auditor` | community-engagement | — | — |
| `community-engagement:ln-644-dependency-graph-auditor` | community-engagement | — | — |
| `community-engagement:ln-645-open-source-replacer` | community-engagement | — | — |
| `community-engagement:ln-646-project-structure-auditor` | community-engagement | — | — |
| `community-engagement:ln-647-env-config-auditor` | community-engagement | — | — |
| `community-engagement:ln-650-persistence-performance-auditor` | community-engagement | — | — |
| `community-engagement:ln-651-query-efficiency-auditor` | community-engagement | — | — |
| `community-engagement:ln-652-transaction-correctness-auditor` | community-engagement | — | — |
| `community-engagement:ln-653-runtime-performance-auditor` | community-engagement | — | — |
| `community-engagement:ln-654-resource-lifecycle-auditor` | community-engagement | — | — |
| `community-engagement:ln-700-project-bootstrap` | community-engagement | — | — |
| `community-engagement:ln-720-structure-migrator` | community-engagement | — | — |
| `community-engagement:ln-721-frontend-restructure` | community-engagement | — | — |
| `community-engagement:ln-722-backend-generator` | community-engagement | — | — |
| `community-engagement:ln-723-seed-data-generator` | community-engagement | — | — |
| `community-engagement:ln-724-artifact-cleaner` | community-engagement | — | — |
| `community-engagement:ln-730-devops-setup` | community-engagement | — | — |
| `community-engagement:ln-731-docker-generator` | community-engagement | — | — |
| `community-engagement:ln-732-cicd-generator` | community-engagement | — | — |
| `community-engagement:ln-733-env-configurator` | community-engagement | — | — |
| `community-engagement:ln-740-quality-setup` | community-engagement | — | — |
| `community-engagement:ln-741-linter-configurator` | community-engagement | — | — |
| `community-engagement:ln-742-precommit-setup` | community-engagement | — | — |
| `community-engagement:ln-743-test-infrastructure` | community-engagement | — | — |
| `community-engagement:ln-760-security-setup` | community-engagement | — | — |
| `community-engagement:ln-761-secret-scanner` | community-engagement | — | — |
| `community-engagement:ln-770-crosscutting-setup` | community-engagement | — | — |
| `community-engagement:ln-771-logging-configurator` | community-engagement | — | — |
| `community-engagement:ln-772-error-handler-setup` | community-engagement | — | — |
| `community-engagement:ln-773-cors-configurator` | community-engagement | — | — |
| `community-engagement:ln-774-healthcheck-setup` | community-engagement | — | — |
| `community-engagement:ln-775-api-docs-generator` | community-engagement | — | — |
| `community-engagement:ln-780-bootstrap-verifier` | community-engagement | — | — |
| `community-engagement:ln-781-build-verifier` | community-engagement | — | — |
| `community-engagement:ln-782-test-runner` | community-engagement | — | — |
| `community-engagement:ln-783-container-launcher` | community-engagement | — | — |
| `community-engagement:ln-810-performance-optimizer` | community-engagement | — | — |
| `community-engagement:ln-811-performance-profiler` | community-engagement | — | — |
| `community-engagement:ln-812-optimization-researcher` | community-engagement | — | — |
| `community-engagement:ln-813-optimization-plan-validator` | community-engagement | — | — |
| `community-engagement:ln-814-optimization-executor` | community-engagement | — | — |
| `community-engagement:ln-820-dependency-optimization-coordinator` | community-engagement | — | — |
| `community-engagement:ln-821-npm-upgrader` | community-engagement | — | — |
| `community-engagement:ln-822-nuget-upgrader` | community-engagement | — | — |
| `community-engagement:ln-823-pip-upgrader` | community-engagement | — | — |
| `community-engagement:ln-830-code-modernization-coordinator` | community-engagement | — | — |
| `community-engagement:ln-831-oss-replacer` | community-engagement | — | — |
| `community-engagement:ln-832-bundle-optimizer` | community-engagement | — | — |
| `community-engagement:ln-910-community-engagement` | community-engagement | — | — |
| `community-engagement:ln-911-github-triager` | community-engagement | — | — |
| `community-engagement:ln-912-community-announcer` | community-engagement | — | — |
| `community-engagement:ln-913-community-debater` | community-engagement | — | — |
| `community-engagement:ln-914-community-responder` | community-engagement | — | — |
| `documentation-pipeline:ln-001-standards-researcher` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-002-best-practices-researcher` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-003-push-all` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-004-agent-config-sync` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-005-environment-scanner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-100-documents-pipeline` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-1000-pipeline-orchestrator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-110-project-docs-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-111-root-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-112-project-core-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-113-backend-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-114-frontend-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-115-devops-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-120-reference-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-130-tasks-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-140-test-docs-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-150-presentation-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-160-docs-skill-extractor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-161-skill-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-162-skill-reviewer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-200-scope-decomposer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-201-opportunity-discoverer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-210-epic-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-220-story-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-221-story-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-222-story-replanner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-230-story-prioritizer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-300-task-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-301-task-creator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-302-task-replanner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-310-multi-agent-validator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-400-story-executor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-401-task-executor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-402-task-reviewer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-403-task-rework` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-404-test-executor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-500-story-quality-gate` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-510-quality-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-511-code-quality-checker` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-512-tech-debt-cleaner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-513-regression-checker` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-514-test-log-analyzer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-520-test-planner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-521-test-researcher` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-522-manual-tester` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-523-auto-test-planner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-610-docs-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-611-docs-structure-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-612-semantic-content-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-613-code-comments-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-614-docs-fact-checker` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-620-codebase-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-621-security-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-622-build-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-623-code-principles-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-624-code-quality-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-625-dependencies-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-626-dead-code-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-627-observability-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-628-concurrency-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-629-lifecycle-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-630-test-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-631-test-business-logic-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-632-test-e2e-priority-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-633-test-value-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-634-test-coverage-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-635-test-isolation-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-636-manual-test-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-637-test-structure-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-640-pattern-evolution-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-641-pattern-analyzer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-642-layer-boundary-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-643-api-contract-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-644-dependency-graph-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-645-open-source-replacer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-646-project-structure-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-647-env-config-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-650-persistence-performance-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-651-query-efficiency-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-652-transaction-correctness-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-653-runtime-performance-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-654-resource-lifecycle-auditor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-700-project-bootstrap` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-720-structure-migrator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-721-frontend-restructure` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-722-backend-generator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-723-seed-data-generator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-724-artifact-cleaner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-730-devops-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-731-docker-generator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-732-cicd-generator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-733-env-configurator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-740-quality-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-741-linter-configurator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-742-precommit-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-743-test-infrastructure` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-760-security-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-761-secret-scanner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-770-crosscutting-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-771-logging-configurator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-772-error-handler-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-773-cors-configurator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-774-healthcheck-setup` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-775-api-docs-generator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-780-bootstrap-verifier` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-781-build-verifier` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-782-test-runner` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-783-container-launcher` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-810-performance-optimizer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-811-performance-profiler` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-812-optimization-researcher` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-813-optimization-plan-validator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-814-optimization-executor` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-820-dependency-optimization-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-821-npm-upgrader` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-822-nuget-upgrader` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-823-pip-upgrader` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-830-code-modernization-coordinator` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-831-oss-replacer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-832-bundle-optimizer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-910-community-engagement` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-911-github-triager` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-912-community-announcer` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-913-community-debater` | documentation-pipeline | — | — |
| `documentation-pipeline:ln-914-community-responder` | documentation-pipeline | — | — |
| `optimization-suite:ln-001-standards-researcher` | optimization-suite | — | — |
| `optimization-suite:ln-002-best-practices-researcher` | optimization-suite | — | — |
| `optimization-suite:ln-003-push-all` | optimization-suite | — | — |
| `optimization-suite:ln-004-agent-config-sync` | optimization-suite | — | — |
| `optimization-suite:ln-005-environment-scanner` | optimization-suite | — | — |
| `optimization-suite:ln-100-documents-pipeline` | optimization-suite | — | — |
| `optimization-suite:ln-1000-pipeline-orchestrator` | optimization-suite | — | — |
| `optimization-suite:ln-110-project-docs-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-111-root-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-112-project-core-creator` | optimization-suite | — | — |
| `optimization-suite:ln-113-backend-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-114-frontend-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-115-devops-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-120-reference-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-130-tasks-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-140-test-docs-creator` | optimization-suite | — | — |
| `optimization-suite:ln-150-presentation-creator` | optimization-suite | — | — |
| `optimization-suite:ln-160-docs-skill-extractor` | optimization-suite | — | — |
| `optimization-suite:ln-161-skill-creator` | optimization-suite | — | — |
| `optimization-suite:ln-162-skill-reviewer` | optimization-suite | — | — |
| `optimization-suite:ln-200-scope-decomposer` | optimization-suite | — | — |
| `optimization-suite:ln-201-opportunity-discoverer` | optimization-suite | — | — |
| `optimization-suite:ln-210-epic-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-220-story-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-221-story-creator` | optimization-suite | — | — |
| `optimization-suite:ln-222-story-replanner` | optimization-suite | — | — |
| `optimization-suite:ln-230-story-prioritizer` | optimization-suite | — | — |
| `optimization-suite:ln-300-task-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-301-task-creator` | optimization-suite | — | — |
| `optimization-suite:ln-302-task-replanner` | optimization-suite | — | — |
| `optimization-suite:ln-310-multi-agent-validator` | optimization-suite | — | — |
| `optimization-suite:ln-400-story-executor` | optimization-suite | — | — |
| `optimization-suite:ln-401-task-executor` | optimization-suite | — | — |
| `optimization-suite:ln-402-task-reviewer` | optimization-suite | — | — |
| `optimization-suite:ln-403-task-rework` | optimization-suite | — | — |
| `optimization-suite:ln-404-test-executor` | optimization-suite | — | — |
| `optimization-suite:ln-500-story-quality-gate` | optimization-suite | — | — |
| `optimization-suite:ln-510-quality-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-511-code-quality-checker` | optimization-suite | — | — |
| `optimization-suite:ln-512-tech-debt-cleaner` | optimization-suite | — | — |
| `optimization-suite:ln-513-regression-checker` | optimization-suite | — | — |
| `optimization-suite:ln-514-test-log-analyzer` | optimization-suite | — | — |
| `optimization-suite:ln-520-test-planner` | optimization-suite | — | — |
| `optimization-suite:ln-521-test-researcher` | optimization-suite | — | — |
| `optimization-suite:ln-522-manual-tester` | optimization-suite | — | — |
| `optimization-suite:ln-523-auto-test-planner` | optimization-suite | — | — |
| `optimization-suite:ln-610-docs-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-611-docs-structure-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-612-semantic-content-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-613-code-comments-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-614-docs-fact-checker` | optimization-suite | — | — |
| `optimization-suite:ln-620-codebase-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-621-security-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-622-build-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-623-code-principles-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-624-code-quality-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-625-dependencies-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-626-dead-code-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-627-observability-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-628-concurrency-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-629-lifecycle-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-630-test-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-631-test-business-logic-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-632-test-e2e-priority-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-633-test-value-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-634-test-coverage-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-635-test-isolation-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-636-manual-test-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-637-test-structure-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-640-pattern-evolution-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-641-pattern-analyzer` | optimization-suite | — | — |
| `optimization-suite:ln-642-layer-boundary-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-643-api-contract-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-644-dependency-graph-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-645-open-source-replacer` | optimization-suite | — | — |
| `optimization-suite:ln-646-project-structure-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-647-env-config-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-650-persistence-performance-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-651-query-efficiency-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-652-transaction-correctness-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-653-runtime-performance-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-654-resource-lifecycle-auditor` | optimization-suite | — | — |
| `optimization-suite:ln-700-project-bootstrap` | optimization-suite | — | — |
| `optimization-suite:ln-720-structure-migrator` | optimization-suite | — | — |
| `optimization-suite:ln-721-frontend-restructure` | optimization-suite | — | — |
| `optimization-suite:ln-722-backend-generator` | optimization-suite | — | — |
| `optimization-suite:ln-723-seed-data-generator` | optimization-suite | — | — |
| `optimization-suite:ln-724-artifact-cleaner` | optimization-suite | — | — |
| `optimization-suite:ln-730-devops-setup` | optimization-suite | — | — |
| `optimization-suite:ln-731-docker-generator` | optimization-suite | — | — |
| `optimization-suite:ln-732-cicd-generator` | optimization-suite | — | — |
| `optimization-suite:ln-733-env-configurator` | optimization-suite | — | — |
| `optimization-suite:ln-740-quality-setup` | optimization-suite | — | — |
| `optimization-suite:ln-741-linter-configurator` | optimization-suite | — | — |
| `optimization-suite:ln-742-precommit-setup` | optimization-suite | — | — |
| `optimization-suite:ln-743-test-infrastructure` | optimization-suite | — | — |
| `optimization-suite:ln-760-security-setup` | optimization-suite | — | — |
| `optimization-suite:ln-761-secret-scanner` | optimization-suite | — | — |
| `optimization-suite:ln-770-crosscutting-setup` | optimization-suite | — | — |
| `optimization-suite:ln-771-logging-configurator` | optimization-suite | — | — |
| `optimization-suite:ln-772-error-handler-setup` | optimization-suite | — | — |
| `optimization-suite:ln-773-cors-configurator` | optimization-suite | — | — |
| `optimization-suite:ln-774-healthcheck-setup` | optimization-suite | — | — |
| `optimization-suite:ln-775-api-docs-generator` | optimization-suite | — | — |
| `optimization-suite:ln-780-bootstrap-verifier` | optimization-suite | — | — |
| `optimization-suite:ln-781-build-verifier` | optimization-suite | — | — |
| `optimization-suite:ln-782-test-runner` | optimization-suite | — | — |
| `optimization-suite:ln-783-container-launcher` | optimization-suite | — | — |
| `optimization-suite:ln-810-performance-optimizer` | optimization-suite | — | — |
| `optimization-suite:ln-811-performance-profiler` | optimization-suite | — | — |
| `optimization-suite:ln-812-optimization-researcher` | optimization-suite | — | — |
| `optimization-suite:ln-813-optimization-plan-validator` | optimization-suite | — | — |
| `optimization-suite:ln-814-optimization-executor` | optimization-suite | — | — |
| `optimization-suite:ln-820-dependency-optimization-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-821-npm-upgrader` | optimization-suite | — | — |
| `optimization-suite:ln-822-nuget-upgrader` | optimization-suite | — | — |
| `optimization-suite:ln-823-pip-upgrader` | optimization-suite | — | — |
| `optimization-suite:ln-830-code-modernization-coordinator` | optimization-suite | — | — |
| `optimization-suite:ln-831-oss-replacer` | optimization-suite | — | — |
| `optimization-suite:ln-832-bundle-optimizer` | optimization-suite | — | — |
| `optimization-suite:ln-910-community-engagement` | optimization-suite | — | — |
| `optimization-suite:ln-911-github-triager` | optimization-suite | — | — |
| `optimization-suite:ln-912-community-announcer` | optimization-suite | — | — |
| `optimization-suite:ln-913-community-debater` | optimization-suite | — | — |
| `optimization-suite:ln-914-community-responder` | optimization-suite | — | — |
| `project-bootstrap:ln-001-standards-researcher` | project-bootstrap | — | — |
| `project-bootstrap:ln-002-best-practices-researcher` | project-bootstrap | — | — |
| `project-bootstrap:ln-003-push-all` | project-bootstrap | — | — |
| `project-bootstrap:ln-004-agent-config-sync` | project-bootstrap | — | — |
| `project-bootstrap:ln-005-environment-scanner` | project-bootstrap | — | — |
| `project-bootstrap:ln-100-documents-pipeline` | project-bootstrap | — | — |
| `project-bootstrap:ln-1000-pipeline-orchestrator` | project-bootstrap | — | — |
| `project-bootstrap:ln-110-project-docs-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-111-root-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-112-project-core-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-113-backend-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-114-frontend-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-115-devops-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-120-reference-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-130-tasks-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-140-test-docs-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-150-presentation-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-160-docs-skill-extractor` | project-bootstrap | — | — |
| `project-bootstrap:ln-161-skill-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-162-skill-reviewer` | project-bootstrap | — | — |
| `project-bootstrap:ln-200-scope-decomposer` | project-bootstrap | — | — |
| `project-bootstrap:ln-201-opportunity-discoverer` | project-bootstrap | — | — |
| `project-bootstrap:ln-210-epic-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-220-story-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-221-story-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-222-story-replanner` | project-bootstrap | — | — |
| `project-bootstrap:ln-230-story-prioritizer` | project-bootstrap | — | — |
| `project-bootstrap:ln-300-task-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-301-task-creator` | project-bootstrap | — | — |
| `project-bootstrap:ln-302-task-replanner` | project-bootstrap | — | — |
| `project-bootstrap:ln-310-multi-agent-validator` | project-bootstrap | — | — |
| `project-bootstrap:ln-400-story-executor` | project-bootstrap | — | — |
| `project-bootstrap:ln-401-task-executor` | project-bootstrap | — | — |
| `project-bootstrap:ln-402-task-reviewer` | project-bootstrap | — | — |
| `project-bootstrap:ln-403-task-rework` | project-bootstrap | — | — |
| `project-bootstrap:ln-404-test-executor` | project-bootstrap | — | — |
| `project-bootstrap:ln-500-story-quality-gate` | project-bootstrap | — | — |
| `project-bootstrap:ln-510-quality-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-511-code-quality-checker` | project-bootstrap | — | — |
| `project-bootstrap:ln-512-tech-debt-cleaner` | project-bootstrap | — | — |
| `project-bootstrap:ln-513-regression-checker` | project-bootstrap | — | — |
| `project-bootstrap:ln-514-test-log-analyzer` | project-bootstrap | — | — |
| `project-bootstrap:ln-520-test-planner` | project-bootstrap | — | — |
| `project-bootstrap:ln-521-test-researcher` | project-bootstrap | — | — |
| `project-bootstrap:ln-522-manual-tester` | project-bootstrap | — | — |
| `project-bootstrap:ln-523-auto-test-planner` | project-bootstrap | — | — |
| `project-bootstrap:ln-610-docs-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-611-docs-structure-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-612-semantic-content-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-613-code-comments-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-614-docs-fact-checker` | project-bootstrap | — | — |
| `project-bootstrap:ln-620-codebase-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-621-security-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-622-build-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-623-code-principles-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-624-code-quality-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-625-dependencies-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-626-dead-code-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-627-observability-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-628-concurrency-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-629-lifecycle-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-630-test-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-631-test-business-logic-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-632-test-e2e-priority-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-633-test-value-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-634-test-coverage-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-635-test-isolation-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-636-manual-test-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-637-test-structure-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-640-pattern-evolution-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-641-pattern-analyzer` | project-bootstrap | — | — |
| `project-bootstrap:ln-642-layer-boundary-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-643-api-contract-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-644-dependency-graph-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-645-open-source-replacer` | project-bootstrap | — | — |
| `project-bootstrap:ln-646-project-structure-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-647-env-config-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-650-persistence-performance-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-651-query-efficiency-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-652-transaction-correctness-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-653-runtime-performance-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-654-resource-lifecycle-auditor` | project-bootstrap | — | — |
| `project-bootstrap:ln-700-project-bootstrap` | project-bootstrap | — | — |
| `project-bootstrap:ln-720-structure-migrator` | project-bootstrap | — | — |
| `project-bootstrap:ln-721-frontend-restructure` | project-bootstrap | — | — |
| `project-bootstrap:ln-722-backend-generator` | project-bootstrap | — | — |
| `project-bootstrap:ln-723-seed-data-generator` | project-bootstrap | — | — |
| `project-bootstrap:ln-724-artifact-cleaner` | project-bootstrap | — | — |
| `project-bootstrap:ln-730-devops-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-731-docker-generator` | project-bootstrap | — | — |
| `project-bootstrap:ln-732-cicd-generator` | project-bootstrap | — | — |
| `project-bootstrap:ln-733-env-configurator` | project-bootstrap | — | — |
| `project-bootstrap:ln-740-quality-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-741-linter-configurator` | project-bootstrap | — | — |
| `project-bootstrap:ln-742-precommit-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-743-test-infrastructure` | project-bootstrap | — | — |
| `project-bootstrap:ln-760-security-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-761-secret-scanner` | project-bootstrap | — | — |
| `project-bootstrap:ln-770-crosscutting-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-771-logging-configurator` | project-bootstrap | — | — |
| `project-bootstrap:ln-772-error-handler-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-773-cors-configurator` | project-bootstrap | — | — |
| `project-bootstrap:ln-774-healthcheck-setup` | project-bootstrap | — | — |
| `project-bootstrap:ln-775-api-docs-generator` | project-bootstrap | — | — |
| `project-bootstrap:ln-780-bootstrap-verifier` | project-bootstrap | — | — |
| `project-bootstrap:ln-781-build-verifier` | project-bootstrap | — | — |
| `project-bootstrap:ln-782-test-runner` | project-bootstrap | — | — |
| `project-bootstrap:ln-783-container-launcher` | project-bootstrap | — | — |
| `project-bootstrap:ln-810-performance-optimizer` | project-bootstrap | — | — |
| `project-bootstrap:ln-811-performance-profiler` | project-bootstrap | — | — |
| `project-bootstrap:ln-812-optimization-researcher` | project-bootstrap | — | — |
| `project-bootstrap:ln-813-optimization-plan-validator` | project-bootstrap | — | — |
| `project-bootstrap:ln-814-optimization-executor` | project-bootstrap | — | — |
| `project-bootstrap:ln-820-dependency-optimization-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-821-npm-upgrader` | project-bootstrap | — | — |
| `project-bootstrap:ln-822-nuget-upgrader` | project-bootstrap | — | — |
| `project-bootstrap:ln-823-pip-upgrader` | project-bootstrap | — | — |
| `project-bootstrap:ln-830-code-modernization-coordinator` | project-bootstrap | — | — |
| `project-bootstrap:ln-831-oss-replacer` | project-bootstrap | — | — |
| `project-bootstrap:ln-832-bundle-optimizer` | project-bootstrap | — | — |
| `project-bootstrap:ln-910-community-engagement` | project-bootstrap | — | — |
| `project-bootstrap:ln-911-github-triager` | project-bootstrap | — | — |
| `project-bootstrap:ln-912-community-announcer` | project-bootstrap | — | — |
| `project-bootstrap:ln-913-community-debater` | project-bootstrap | — | — |
| `project-bootstrap:ln-914-community-responder` | project-bootstrap | — | — |
| `ponytail:ponytail` | ponytail | — | — |
| `ponytail:ponytail-audit` | ponytail | — | — |
| `ponytail:ponytail-debt` | ponytail | — | — |
| `ponytail:ponytail-gain` | ponytail | — | — |
| `ponytail:ponytail-help` | ponytail | — | — |
| `ponytail:ponytail-review` | ponytail | — | — |
| `claude-mem:mem-search` | claude-mem | — | — |
| `web-asset-generator:web-asset-generator` | web-asset-generator | — | — |
| `user:codebase-audit` | user | — | — |
| `user:design-motion-principles` | user | — | — |
| `user:devops-github` | user | — | — |
| `user:impeccable` | user | — | — |
| `user:ui-uix-enterprise` | user | — | — |


**Note:** Skill SKILL.md files listed under "Replaces" are not generated — the installed plugin provides superior coverage. Reference the plugin's documentation directly.

All governance rules are in **this file**.
