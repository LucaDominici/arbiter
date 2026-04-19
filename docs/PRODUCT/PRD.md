# Arbiter — Product Requirements Document

**Status:** Active
**Version:** 0.1
**Last updated:** 2026-04-09
**Owner:** Luca Dominici

---

## Vision

Arbiter installs a complete, standards-aligned AI governance stack into any project in one command. No manual configuration, no drift, no duplication.

Any developer using AI coding agents should be able to run `npx arbiter init`, answer a few questions about their project, and receive a production-grade governance stack that all their AI tools understand natively.

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

- 200+ tests: per-detector, per-generator, per-language matrix, per-governance-level
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

### Phase 10 — Viafera-Aligned Enforcement (M22-M25)

Based on exhaustive gap analysis (`VIAFERA-ALIGNMENT.md`). Principle: **once chosen, enforced** (`ENFORCEMENT-PHILOSOPHY.md`).

- Architecture verification suite: full ArchUnit (Java), eslint-plugin-boundaries (TS), cargo-deny (Rust), go/analysis (Go), import-linter (Python)
- Mutation testing as hard gate: PIT (Java), Stryker (TS), cargo-mutants (Rust), go-mutesting (Go), mutmut (Python)
- Security scanning suite: dep audit, secrets detection (Gitleaks), PII scan, container scan (Trivy)
- Nightly pipeline (L3): E2E full, mutation, security deep, evidence harness, change detection

### Phase 11 — Testing Discipline (M26-M28)

- Real database testing: Testcontainers for all stacks, H2/in-memory explicitly forbidden
- Behavioral test structure: @Nested/@DisplayName (Java), describe/it (TS), subtests (Go), pytest classes (Python)
- Contract testing (configurable): Pact consumer/provider for projects with APIs

### Phase 12 — Code Quality Enforcement (M29-M30)

- Complete static analysis suite: Checkstyle + PMD + SpotBugs (Java), ESLint full (TS), clippy pedantic (Rust), golangci-lint full (Go), ruff full (Python)
- Coverage tool integration: JaCoCo in build.gradle (Java), vitest config (TS), cargo-tarpaulin (Rust), go test -cover (Go), pytest-cov (Python)

### Phase 13 — Ecosystem (M31-M32, shipped)

- Configuration skill (`/arbiter configure`): post-init feature toggle, threshold override, arbiter.json v2 (M31)
- Extended AI tool support: Gemini CLI, Windsurf, Aider generators + brownfield detection (M32)
- Plugin API v1: `ArbiterPlugin` interface + `arbiter plugin add/remove/list` CLI; organizations ship framework generators without forking arbiter (M32)

---

## Supported Stacks Matrix

| Language   | Detection Signal              | Build         | Lint          | Format   | Test        |
| ---------- | ----------------------------- | ------------- | ------------- | -------- | ----------- |
| TypeScript | `package.json`                | npm/yarn/pnpm | eslint        | prettier | vitest/jest |
| Java       | `pom.xml` / `build.gradle`    | gradle/maven  | checkstyle    | —        | junit       |
| Rust       | `Cargo.toml`                  | cargo         | clippy        | rustfmt  | cargo test  |
| Go         | `go.mod`                      | go            | golangci-lint | gofmt    | go test     |
| Python     | `pyproject.toml` / `setup.py` | pip/uv        | ruff          | ruff     | pytest      |

Multi-language repos: detected from the presence of multiple signal files. Arbiter generates a polyglot `AGENTS.md` covering all detected stacks.

---

## Governance Levels

| Level  | Gate                                                        | Use case                                                    |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **L1** | Lint + format + unit tests                                  | Pre-commit, fast feedback, personal repos                   |
| **L2** | L1 + integration tests + coverage ≥ 80% + dependency audit  | Default, matches CI, team repos                             |
| **L3** | L2 + E2E tests + coverage ≥ 85% + SBOM + evidence artifacts | Audit-grade, regulated industries, OSS with strict policies |

Arbiter itself operates at L3 (dogfooding its own highest governance tier).

---

## Success Metrics

| Metric                                                             | Target                     |
| ------------------------------------------------------------------ | -------------------------- |
| Time from `npx arbiter init` to complete governance stack          | < 60 seconds               |
| Tests passing (all stacks, all governance levels)                  | 200+ tests, 85%+ coverage  |
| Idempotency: running init twice produces no unintended changes     | 100%                       |
| Brownfield safety: existing customizations preserved               | 100% of custom hooks/rules |
| Zero proprietary or tool-specific lock-in in generated `AGENTS.md` | Always                     |

---

## Constraints

- **Node.js ≥ 20** required (ES module support, `node:` protocol)
- **`gh` CLI required** for GitHub operations (labels, branch protection, repository config)
- **No cloud dependency**: all generation is local; GitHub ops require authenticated `gh` CLI
- **Offline-first**: `arbiter init --yes --no-github` must work with no network access

---

## Open Questions

| Question                                       | Status  | Recommendation                                               |
| ---------------------------------------------- | ------- | ------------------------------------------------------------ |
| npm package name (`arbiter` vs `@arbiter/cli`) | Decided | `@arbiter/cli` (avoids conflicts, namespace reserved)        |
| License                                        | Open    | MIT (compatible with AGENTS.md spec, standard for CLI tools) |
| Docs site                                      | Open    | Start markdown-only; plan Mintlify for v1.0                  |
| Plugin API design                              | Future  | Not needed before v1.0                                       |
