---
generated: true
source: 'docs/PRODUCT/PRD.md'
source_sha: 'ec6604d36dc7875dcf05781644c51ebf14aebf6e'
last_updated: '2026-06-21'
---

# Arbiter — Product Requirements Document

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/PRD.md](../docs/PRODUCT/PRD.md)

# Arbiter — Product Requirements Document

**Status:** Active
**Version:** 0.2 (in-progress)
**Last updated:** 2026-06-04
**Owner:** Luca Dominici

---

## Vision

Arbiter installs a complete, standards-aligned AI governance stack into any project in one command. No manual configuration, no drift, no duplication.

Any developer using AI coding agents should be able to run `npx @arbiter/cli init`, answer a few questions about their project, and receive a production-grade governance stack that all their AI tools understand natively.

---

## Problem

Teams adopting AI coding agents face a consistent setup problem:

1. **Every tool needs its own config** — Claude needs `CLAUDE.md`, Codex needs `CODEX.md`, Cursor needs `.cursorrules`, Copilot needs `copilot-instructions.md`, Gemini needs `GEMINI.md`, Windsurf needs `windsurf-instructions.md`, Aider needs `.aider.conf.yml`. Each has a different format.
2. **Configs diverge immediately** — Without a canonical source, each tool's config drifts independently. Different tools get different rules, different test policies, different commit conventions.
3. **No enforcement at edit time** — AI agents make edits but nothing enforces invariants (no magic strings, no console.log in production, correct branch naming) as they work.
4. **GitHub infra is manual** — CI, PR templates, issue templates, branch protection, labels — all set up by hand per repo, inconsistently.
5. **Brownfield projects are left behind** — Existing repos with custom governance can't adopt new tooling without risking loss of customizations.

The result: teams either skip governance (risky) or hand-configure everything (expensive and drift-prone).

---

## Target Users

### Primary: Solo developer with multiple repos

A developer maintaining 3-10 repos who uses Claude Code or Codex daily. They want consistent governance across all repos without maintaining configs manually. They care about idempotency — running `arbiter update` should be safe.

### Secondary: Engineering lead at a startup (5-30 engineers)

Setting up a new repo or standardizing an existing one. They need L2/L3 governance (coverage thresholds, CI enforcement, audit artifacts). They want the team to have consistent rules without lengthy onboarding.

### Tertiary: Open-source maintainer

Maintaining a public repo and wanting to signal AI-governance maturity to contributors. They want `AGENTS.md` present so any contributor using AI tools gets the right context automatically. GitHub templates and branch protection are important.

---

## Non-Goals

| Non-goal                                          | Rationale                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime enforcement (blocking bad code)           | That's the AI tool's job. Arbiter sets policy, tools enforce it.                                                                                                      |
| AI model configuration                            | Which model to use is out of scope. Arbiter configures governance, not model selection.                                                                               |
| Replacing ai-rulez                                | ai-rulez is a format translator. Arbiter is a governance installer. They are complementary — if ai-rulez is detected, Arbiter delegates tool config generation to it. |
| IDE plugins (VS Code extension, JetBrains plugin) | CLI-first. IDE integration comes through tool configs, not Arbiter directly.                                                                                          |
| Locking to a specific AI tool                     | Arbiter is tool-agnostic. The canonical source (`AGENTS.md`) is read natively by all major tools.                                                                     |
| Cloud/SaaS dashboard                              | Offline-first CLI. No accounts, no telemetry, no cloud dependency.                                                                                                    |

---

## Features by Phase

### Phase 1 — Core Generation (shipped in v0.1)

- `AGENTS.md` generation: canonical governance file (AAIF standard)
- Thin-pointer configs: `CLAUDE.md`, `CODEX.md`
- Hook scripts: enforcement at edit time (no-console, no-magic-strings, etc.)
- Interactive wizard: language/framework detection, tool selection, governance level
- `--yes` flag: non-interactive mode with detected defaults
- Conflict resolution: backup-and-replace for governance files, deep-merge for `settings.json`, skip-if-exists for hooks

### Phase 2 — GitHub Integration (shipped in v0.1)

- CI workflow generation (parameterized by stack)
- PR and issue templates
- Dependabot configuration
- GitHub labels (standard set per ADR-007)
- Branch protection rules
- `CODEOWNERS` generation

### Phase 3 — Update and Diff (shipped in v0.1)

- `arbiter update`: re-run generation on existing repo (idempotent)
- `arbiter diff`: preview what would change without writing
- `arbiter.json`: persisted config (skip wizard on subsequent runs)

### Phase 4 — Extended Tool Support (shipped in v0.1)

- Cursor support: `.cursorrules` generation
- Copilot support: `copilot-instructions.md` generation
- Gemini CLI support: `.gemini/GEMINI.md` generation
- Windsurf support: `windsurf-instructions.md` generation
- Aider support: `.aider.conf.yml` generation
- ai-rulez detection: if `.ai-rulez/` exists, skip tool configs; generate only AGENTS.md + GitHub infra

### Phase 5 — Comprehensive Tests and Documentation (M5-M7)

- 9,000+ tests: per-detector, per-generator, per-language matrix, per-governance-level
- 4-layer documentation hierarchy: PRODUCT / ARCHITECTURE / DEVELOPMENT / REFERENCE
- Testing strategy documented (claim-backed testing: every README claim has a test)

### Phase 6 — Smart Init Wizard Redesign (M10)

- State-reactive flow: detect existing governance before asking questions
- Brownfield mode: scan existing configs, display migration plan, confirm before touching anything
- Greenfield mode: show generation preview before writing
- `--dry-run` flag for `arbiter init`
- Show-before-modify: no silent overwrites

### Phase 7 — Foundation Repair + Stack Parity (M12-M13)

- Go and Python stack parity: functional CI, gates, hooks, coding standards, invariants
- Java Maven support (currently only Gradle in templates)
- Documentation alignment: fix all .sh → .mjs drift, dead files, AGENTS.md claim accuracy
- Retroactive fix for all CRITICAL/MAJOR findings from M1-M11 analysis (ADR-014)

### Phase 8 — Tech Debt Prevention (M14-M16)

- Arbiter self-enforcement: coverage thresholds, complexity limits, dead code detection, git hooks, commitlint
- Generated per-stack debt gates: coverage, complexity, dead code, circular deps for all 5 stacks
- Novel anti-tech-debt mechanism: proactive debt detection with baseline tracking and regression prevention
- Each stack gets equivalent enforcement (not just TypeScript/Rust/Java)

### Phase 9 — Advanced Generation (M17-M21)

- Advanced hooks: plan-anchor, debug-state, pre-compact, dispatch
- Rich invariant catalog: 25+ invariants across 5 tiers, all stacks
- Skills and sub-agent generation: skeleton skills and agent definitions
- SSOT framework generation: knowledge map, track router, engineering defaults
- Richer GitHub integration: task-brief templates, epic templates, project boards

### Phase 10 — Production Baseline Enforcement (M22-M30, in progress)

Based on exhaustive gap analysis. Principle: **once chosen, enforced** (`ENFORCEMENT-PHILOSOPHY.md`).
M22 (architecture verification suite) shipped. M23-M24 (mutation, security) and M29-M30 (static analysis, coverage) in progress.

- Arc

*[content truncated — see source for full text]*
