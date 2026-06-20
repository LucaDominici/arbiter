---
generated: true
source: 'docs/architecture/ARCHITECTURE.md'
source_sha: 'a80009cc809344baaba2a53a61b45c3952c3d915'
last_updated: '2026-06-20'
---

# arbiter Architecture

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/architecture/ARCHITECTURE.md](../docs/architecture/ARCHITECTURE.md)

# arbiter Architecture

Consolidated architecture reference for arbiter: the system map, the canonical source model, the template pipeline, conflict resolution, the dual-track contract, the evidence-bundle schema, and skeleton governance. Sections below were previously separate files under `docs/architecture/`.

---

## arbiter Architecture

Spine for `docs/architecture/`. Read these in order to understand how arbiter
generates governance scaffolding.

## Reading order

1. [`OVERVIEW.md`](#architecture-overview) — system map: CLI → generators → templates → target project
2. [`CANONICAL-SOURCE-MODEL.md`](#canonical-source-model--deep-dive) — SSOT layering and authority chain
3. [`TEMPLATE-SYSTEM.md`](#template-system) — EJS template pipeline; how `src/templates/*.ejs` becomes target-project artifacts
4. [`CONFLICT-RESOLUTION.md`](#arbiter--conflict-resolution) — merge strategy when re-running `arbiter init` over an existing project
5. [`dual-track-contract.md`](#dual-track-contract) — CANON-16 dual-track rule: changes to self-config must ship with matching template change
6. [`evidence-bundle.md`](#architecture-evidence-bundle-schema-inv-90) — schema for `.arbiter/evidence/*` artifacts
7. [`skeleton-governance.md`](#skeleton-governance-architecture) — what the planning skeleton enforces

## Cross-cutting concepts

| Concept               | Source                                                     |
| --------------------- | ---------------------------------------------------------- |
| Invariants (INV-NN)   | `../../GLOBAL_INVARIANTS.md` + `../../AGENTS.md`           |
| Process rules (CANON) | `../SYSTEM/CANON.md`                                       |
| Decision log (ADR)    | `../ADR/`                                                  |
| Patterns catalog      | `../METHOD/PATTERNS_CATALOG.md` (planned; not yet present) |
| Test taxonomy         | `../TEST_TAXONOMY.md`                                      |
| CI tier model         | `../SYSTEM/CI-TIER-MODEL.md`                               |

## When to file an ADR

A change qualifies as architectural (and needs an ADR under `../ADR/`) when it:

- Adds, removes, or changes a public API surface
- Changes the dual-track contract (CANON-16)
- Changes a governance level threshold (L1/L2/L3)
- Touches the SSOT layering (CANONICAL_PATHS, SSOT_CORE_SET)
- Introduces a new external dependency or runtime requirement
- Reverses or supersedes a previous ADR

---

## Arbiter — Architecture Overview

Arbiter generates a multi-layer governance stack for AI-assisted development. The architecture has one invariant: **a single canonical source of truth**, with all tool-specific configs as thin overlays.

---

## Canonical Source Model

```
AGENTS.md                           <- Layer 0: Canonical governance
|                                      (AAIF standard, read natively by all major AI tools)
|
+-- .claude/CLAUDE.md               <- Layer 1: Claude Code overlay
|   +-- settings.json               |   Hooks wiring, permissions, sub-agent definitions
|   +-- hooks/                      |   PreToolUse/PostToolUse enforcement scripts
|   +-- rules/                      |   Additional rules (lifecycle, exec protocol)
|   +-- commands/                   |   Slash commands (/ship orchestration, /task engine/CLI)
|
+-- .agents/CODEX.md                <- Layer 1: Codex overlay
|   +-- rules/                      |   Mirrored rule set (same content as .claude/rules/)
|   +-- plan/                       |   Task plan artifacts (PLAN.json, CONTEXT_PACK.md)
|
+-- .github/                        <- Layer 2: GitHub integration
|   +-- workflows/ci.yml            |   CI pipeline (parameterized by stack)
|   +-- PULL_REQUEST_TEMPLATE.md    |   Structured PR descriptions
|   +-- ISSUE_TEMPLATE/             |   Bug, feature, task brief templates
|   +-- dependabot.yml              |   Automated dependency updates
|   +-- CODEOWNERS                  |   Review assignment
|
+-- scripts/check-all.mjs           <- Layer 2: Quality gate runner
```

---

## Layer 0 — AGENTS.md (Canonical)

`AGENTS.md` is the single source of truth for:

- **Project identity** — name, stack, build/test commands, gate command
- **Authority hierarchy** — which documents override which
- **Invariants** — non-negotiable rules (architecture, code quality, process)
- **Coding standards** — language-specific conventions
- **Testing policy** — what must be tested and how
- **Commit convention** — type(scope): summary format
- **Branch strategy** — naming, protection rules
- **Gate system** — L1/L2/L3 layered quality checks
- **Multi-agent extensions** — per-tool capability table

### Why AGENTS.md

`AGENTS.md` was co-donated to the [AAIF (Agentic AI Interoperability Foundation)](https://agents.md/) by Anthropic and OpenAI (December 2025) as the universal AI governance standard. It is:

- Natively read by: Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf
- Adopted by 60,000+ projects
- A Linux Foundation standard under the AAIF

Using `AGENTS.md` as canonical means governance is written once and available to every tool, present and future, without tool-specific duplication.

---

## Layer 1 — Tool Overlays (Thin Pointers)

Each tool config opens with an explicit pointer to `AGENTS.md`:

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

### What tool configs add (and only this)

| Tool             | Claude Code                                 | Codex                           |
| ---------------- | ------------------------------------------- | ------------------------------- |
| Auth/Permissions | `settings.json` permissions + allowed tools | —                               |
| Hook wiring      | `settings.json` hooks section               | —                               |
| Hook scripts     | `.claude/hooks/*.mjs`                       | —                               |
| Slash commands   | `.claude/commands/*.md`                     | —                               |
| Sub-agents       | `.claude/agents/*.md`                       | —                               |
| Plan schema      | —                                           | `CODEX.md` §Plan Schema         |
| Exec router      | —                                           | `CODEX.md` §Execution Router    |
| Context pack     | —                                           | `.agents/plan/CONTEXT_PACK.md`  |
| Rule mirror      | `.claude/rules/`                            | `.agents/rules/` (same content) |

### What tool configs must NOT contain

- Invariants (those live in `AGENTS.md`)
- Coding standards (those live in `AGENTS.md`)
- Commit conventions (those live in `AGENTS.md`)
- Testing policy (those live in `AGENTS.md`)
- Authority hierarchy (lives in `AGENTS.md`)

Anything duplicated between `AGENTS.md` and a tool config will drift.

---

## Layer 2 — GitHub + Quality Gates

### CI Workflow

Generated at `.github/workflows/ci.yml`, parameterized by detected stack:

- TypeScript: `npm ci -> typecheck -> lint -> test --coverage`
- Java: `gradlew checkstyleMain -> gradlew test`
- Rust: `cargo fmt --check -> cargo clippy -> cargo test`
- Go: `gofmt -> golangci-lint -> go test`
- Python: `ruff check -> ruff format -> pytest`

Always includes a `ci-required` job as the merge gate (required status check for branch protection).

### Quality Gate Script (`scripts/check-all.mjs`)

Three-level gate system:

| Level | Checks                              | When                  |
| ----- | ----------------------------------- | --------------------- |
| L1    | Format + lint + unit tests          | Pre-commit (fast)     |
| L2    | L1 + integration + coverage + audit | Pre-push (matches CI) |
| L3    | L2 + E2E + evidence                 | Release / audit       |

```bash
node scripts/check-all.mjs L1   # fast local check
node scripts/check-all.mjs L2   # full g

*[content truncated — see source for full text]*
