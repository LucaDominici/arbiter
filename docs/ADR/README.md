# Architectural Decision Records

This directory contains the Architectural Decision Records (ADRs) for the Arbiter project. Each ADR captures a significant design decision, its context, rationale, and consequences.

## Process

1. Propose a new ADR by creating a file following the naming convention: `NNN-short-title.md`
2. Use the template below
3. Set status to `Proposed`, then update to `Accepted` after review
4. ADRs are append-only: superseded decisions get status `Superseded by ADR-NNN`, never deleted

## Template

```markdown
# ADR-NNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN
**Date:** YYYY-MM-DD
**Deciders:** [names]

## Context

[What is the issue that motivates this decision?]

## Decision

[What is the change that we're proposing and/or doing?]

## Rationale

[Why is this the best option? What alternatives were considered?]

## Consequences

[What are the positive and negative effects of this decision?]
```

## Index

| #   | Title                                                                   | Status   | Date       | Summary                                                                                                             |
| --- | ----------------------------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| 001 | [AGENTS.md as canonical governance source](001-agents-md-canonical.md)  | Accepted | 2026-04-01 | Single governance file for all AI coding tools, using the AAIF standard                                             |
| 002 | [Thin pointer pattern for tool overlays](002-thin-pointer-pattern.md)   | Accepted | 2026-04-01 | Tool configs reference AGENTS.md and add only tool-specific settings                                                |
| 003 | [gh CLI as required dependency](003-gh-cli-required.md)                 | Accepted | 2026-04-01 | GitHub features require `gh` CLI; skip gracefully if unavailable                                                    |
| 004 | [skipIfExists on hooks, rules, and commands](004-skip-if-exists.md)     | Accepted | 2026-04-01 | Never overwrite project-customized files on re-init                                                                 |
| 005 | [Deep merge for settings.json](005-deep-merge-settings.md)              | Accepted | 2026-04-01 | Union-merge permissions and hooks; incoming value wins for other keys                                               |
| 006 | [TypeScript + Node for the CLI runtime](006-typescript-node-cli.md)     | Accepted | 2026-04-01 | TypeScript + Node via npx for zero-install distribution                                                             |
| 007 | [15 standard labels as canonical set](007-standard-labels.md)           | Accepted | 2026-04-01 | Minimal label set: 8 type + 4 size + 3 priority                                                                     |
| 008 | [Governance levels L1/L2/L3](008-governance-levels.md)                  | Accepted | 2026-04-01 | Three nested gate levels for pre-commit, CI, and audit workflows                                                    |
| 009 | [EJS over Handlebars for templates](009-ejs-over-handlebars.md)         | Accepted | 2026-04-01 | EJS chosen for plain-JS interpolation, zero learning curve, and existing usage across all 32 templates              |
| 010 | [ai-rulez coexistence — skip tool configs](010-ai-rulez-coexistence.md) | Accepted | 2026-04-01 | When ai-rulez is detected, skip tool config generation; AGENTS.md and GitHub scaffolding still generated            |
| 011 | [Brownfield-first design](011-brownfield-first-design.md)               | Accepted | 2026-04-01 | Per-file conflict resolution strategies (backup+replace, deep merge, skipIfExists) designed for existing projects   |
| 012 | [3-layer documentation enforcement](012-doc-enforcement.md)             | Accepted | 2026-04-01 | CI blocks PRs with code changes but no docs updates; advisory hook + CI job + generated for L2+ target projects     |
| 013 | [Fixture-based per-claim testing](013-testing-matrix.md)                | Accepted | 2026-04-01 | Every documented behavior maps to a dedicated test; real filesystem fixtures, no fs mocking                         |
| 014 | [Tech debt prevention strategy](014-tech-debt-prevention-strategy.md)   | Accepted | 2026-04-02 | Foundation-first resequencing: fix Go/Python, align docs, self-enforce, then generate debt gates for all stacks     |
| 015 | [Debt ratchet](015-debt-ratchet.md)                                     | Accepted | 2026-04-08 | Baseline-anchored regression prevention: captures debt metrics, gates on decay, ratchets on improvement             |
| 016 | [RestAssured + mutation testing](016-restassured-mutation-testing.md)   | Accepted | 2026-04-08 | 3-layer Java enforcement: no MockMvc (hook + ArchUnit + policy), mandatory pitest at L2 gate (#61)                  |
| 017 | [Skills & sub-agents generation](017-skills-agents-generation.md)       | Accepted | 2026-04-08 | Generate 7 skills + 2 agents for Claude; stack-parameterized, skipIfExists, aiRulez-aware (#36)                     |
| 018 | [SSOT framework generation](018-ssot-framework-generation.md)           | Accepted | 2026-04-09 | Single-source-of-truth artifact pipeline — invariants flow from one root through all generated docs and hooks (#38) |
| 019 | [Richer GitHub integration](019-richer-github-integration.md)           | Accepted | 2026-04-09 | Labels, branch protection, project board, and issue templates scaffolded per target repo (#39)                      |
| 020 | [CLI-first over MCP](020-cli-first-over-mcp.md)                         | Accepted | 2026-04-11 | All tool integrations — arbiter-internal and generated — use CLI invocation; MCP is never a dependency (#95)        |
