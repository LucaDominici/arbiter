---
title: 'Architectural Decision Records'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

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

| #    | Title                                                                                               | Status                | Date       | Summary                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 001  | [AGENTS.md as canonical governance source](001-agents-md-canonical.md)                              | Accepted              | 2026-04-01 | Single governance file for all AI coding tools, using the AAIF standard                                                        |
| 002  | [Thin pointer pattern for tool overlays](002-thin-pointer-pattern.md)                               | Accepted              | 2026-04-01 | Tool configs reference AGENTS.md and add only tool-specific settings                                                           |
| 003  | [gh CLI as required dependency](003-gh-cli-required.md)                                             | Accepted              | 2026-04-01 | GitHub features require `gh` CLI; skip gracefully if unavailable                                                               |
| 004  | [skipIfExists on hooks, rules, and commands](004-skip-if-exists.md)                                 | Accepted              | 2026-04-01 | Never overwrite project-customized files on re-init                                                                            |
| 005  | [Deep merge for settings.json](005-deep-merge-settings.md)                                          | Accepted              | 2026-04-01 | Union-merge permissions and hooks; incoming value wins for other keys                                                          |
| 006  | [TypeScript + Node for the CLI runtime](006-typescript-node-cli.md)                                 | Accepted              | 2026-04-01 | TypeScript + Node via npx for zero-install distribution                                                                        |
| 007  | [15 standard labels as canonical set](007-standard-labels.md)                                       | Accepted              | 2026-04-01 | Minimal label set: 8 type + 4 size + 3 priority                                                                                |
| 008  | [Governance levels L1/L2/L3](008-governance-levels.md)                                              | Accepted              | 2026-04-01 | Three nested gate levels for pre-commit, CI, and audit workflows                                                               |
| 009  | [EJS over Handlebars for templates](009-ejs-over-handlebars.md)                                     | Accepted              | 2026-04-01 | EJS chosen for plain-JS interpolation, zero learning curve, and existing usage across all 32 templates                         |
| 010  | [ai-rulez coexistence — skip tool configs](010-ai-rulez-coexistence.md)                             | Accepted              | 2026-04-01 | When ai-rulez is detected, skip tool config generation; AGENTS.md and GitHub scaffolding still generated                       |
| 011  | [Brownfield-first design](011-brownfield-first-design.md)                                           | Accepted              | 2026-04-01 | Per-file conflict resolution strategies (backup+replace, deep merge, skipIfExists) designed for existing projects              |
| 012  | [3-layer documentation enforcement](012-doc-enforcement.md)                                         | Accepted              | 2026-04-01 | CI blocks PRs with code changes but no docs updates; advisory hook + CI job + generated for L2+ target projects                |
| 013  | [Fixture-based per-claim testing](013-testing-matrix.md)                                            | Accepted              | 2026-04-01 | Every documented behavior maps to a dedicated test; real filesystem fixtures, no fs mocking                                    |
| 014  | [Tech debt prevention strategy](014-tech-debt-prevention-strategy.md)                               | Accepted              | 2026-04-02 | Foundation-first resequencing: fix Go/Python, align docs, self-enforce, then generate debt gates for all stacks                |
| 015  | [Debt ratchet](015-debt-ratchet.md)                                                                 | Superseded by ADR-022 | 2026-04-08 | v1 schema (4 metrics); superseded by ADR-022 which adds v2 schema, per-stack violation counts, debt-lib.mjs                    |
| 016  | [RestAssured + mutation testing](016-restassured-mutation-testing.md)                               | Superseded by ADR-029 | 2026-04-08 | 3-layer Java enforcement: no MockMvc (hook + ArchUnit + policy), mandatory pitest; mutation portion superseded by ADR-029      |
| 017  | [Skills & sub-agents generation](017-skills-agents-generation.md)                                   | Accepted              | 2026-04-08 | Generate 7 skills + 2 agents for Claude; stack-parameterized, skipIfExists, aiRulez-aware (#36)                                |
| 018  | [SSOT framework generation](018-ssot-framework-generation.md)                                       | Accepted              | 2026-04-09 | Single-source-of-truth artifact pipeline — invariants flow from one root through all generated docs and hooks (#38)            |
| 019  | [Richer GitHub integration](019-richer-github-integration.md)                                       | Accepted              | 2026-04-09 | Labels, branch protection, project board, and issue templates scaffolded per target repo (#39)                                 |
| 020  | [CLI-first over MCP](020-cli-first-over-mcp.md)                                                     | Accepted              | 2026-04-11 | All tool integrations — arbiter-internal and generated — use CLI invocation; MCP is never a dependency (#95)                   |
| 021  | [Archetype axis and architecture style knob](021-archetype-axis.md)                                 | Accepted              | 2026-04-15 | Five orthogonal axis fields on ProjectConfig (archetype, architectureStyle, etc.) enabling stack-aware generation (#82)        |
| 022  | [Universal baseline-freeze (MB)](022-universal-baseline-freeze.md)                                  | Accepted              | 2026-04-15 | Debt ratchet v2 schema, per-stack violation counts, debt-lib.mjs helper, --brownfield flag; supersedes ADR-015                 |
| 023  | [Self-hosted CI runner (docker-ci-build)](023-self-hosted-ci-runner.md)                             | Accepted              | 2026-04-15 | CI jobs run on self-hosted runner via CI_BUILD_RUNNER_LABEL repo variable (#128)                                               |
| 024  | [Suppression pattern with mandatory expiry](024-suppression-expiry-escape-hatch.md)                 | Accepted              | 2026-04-16 | principled suppressions/ directory with expiry gate; suppress-until never-suppress pattern (MC)                                |
| 025  | [Claim-verified governance documents](025-claim-verified-governance-docs.md)                        | Accepted              | 2026-04-16 | STRIDE/RACI HIGH+CRITICAL claims require @Security/@RACI test annotations; missing evidence fails gate (#90)                   |
| 026  | [Scaled thresholds and practical/pedantic tiers](026-scaled-thresholds.md)                          | Accepted              | 2026-04-16 | Coverage/mutation thresholds scale with project size; practical vs pedantic strictness profiles (#88)                          |
| 027  | [Real-project nightly matrix](027-real-project-nightly-matrix.md)                                   | Superseded by ADR-030 | 2026-04-16 | Nightly workflow + fixture-driven matrix; superseded by ADR-030 which ships the full nightly pipeline (#87)                    |
| 028  | [Grace period for level upgrade + contract type axis](028-level-upgrade-grace-and-contract-type.md) | Accepted              | 2026-04-16 | Soft-grace window on L1→L2 upgrade; contractType axis (library/service/app) for threshold variance (#92, #93)                  |
| 029a | [Mutation testing as hard L3 gate](029-mutation-testing-hard-gate.md)                               | Superseded by ADR-030 | 2026-04-17 | Multi-stack 85% mutation threshold at L3; superseded by ADR-030 (mutation moved to nightly, not L2 gate) (#71)                 |
| 029b | [Security scanning suite (M24)](029-security-scanning.md)                                           | Accepted              | 2026-04-17 | PII scan (early-fail, pre-L1), gitleaks + dep-audit (L2+grace); per-stack tools; INV-11/12/13 enforced (#72)                   |
| 030  | [Nightly pipeline & evidence harness](030-nightly-evidence-harness.md)                              | Accepted              | 2026-04-17 | Nightly cron pipeline: mutation testing, E2E, load tests, Trivy; SUMMARY.json PR gate; supersedes ADR-027/029 (#73)            |
| 031  | [Plugin API v1](031-plugin-api-v1.md)                                                               | Accepted              | 2026-04-19 | First-party plugin API: PluginManifest, lifecycle hooks, generator augmentation; npx-installable plugins (#405)                |
| 032  | [Hook hardness manifest and empirical verification](032-hook-hardness-manifest.md)                  | Accepted              | 2026-05-05 | hooks-manifest.json classifies hooks as HARD/ADVISORY; CI verifies hardness claims empirically (#402, #405, #410)              |
| 033  | [Generated githooks for all language stacks](033-githooks-multi-stack.md)                           | Accepted              | 2026-05-05 | .githooks/ directory generated for all 6 stacks with pre-commit, commit-msg, pre-push hooks (#401)                             |
| 034  | [Phase-tracked lifecycle hard enforcement](034-phase-lifecycle-hard-enforcement.md)                 | Accepted              | 2026-05-05 | Completion guard promoted to exit 2 (hard-block); phase lifecycle enforced by UserPromptSubmit hook (#406)                     |
| 035  | [Pluggable decomposition backend](035-pluggable-decomposition-backend.md)                           | Accepted              | 2026-05-05 | DecompositionBackend abstraction with built-in and external (MCP) implementations (#408)                                       |
| 036  | [Lane/track awareness for multi-layer projects](036-lane-awareness.md)                              | Accepted              | 2026-05-05 | Auto-detect monorepo lanes (frontend/backend/infra/shared) from top-level dirs; per-lane gate config (#403)                    |
| 037a | [Evidence harness for target projects](037-evidence-harness-target-projects.md)                     | Accepted              | 2026-05-06 | Generate SUMMARY.json collector + nightly.yml + evidence-check.mjs for L2+ target projects (#407)                              |
| 037b | [Java static analysis: production baseline parity audit](037-java-static-analysis-baseline.md)      | Accepted              | 2026-05-10 | PMD codestyle added for 7/7 production baseline category parity; ArchUnit rules aligned to production baseline snapshot (#404) |
| 038  | [Mission elevation — v1.0 scope](038-mission-elevation-v1.md)                                       | Accepted              | 2026-05-10 | Remove Obsidian vault from core; define v1.0 scope as CLI + GitHub scaffolding + 5-stack governance                            |
| 039  | [V1 verification bridge](039-verification-bridge-v1.md)                                             | Accepted              | 2026-05-13 | `arbiter verify plan` CLI command validates plan files against invariant catalog (#253)                                        |
