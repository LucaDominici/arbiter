---
generated: true
source: 'docs/SYSTEM/DECISIONS.md'
source_sha: 'b6ebe33e7ce8c7809e53c7323030088944cf4260'
last_updated: '2026-06-30'
---

# Architectural Decision Records — Generated Digest

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/DECISIONS.md](../docs/SYSTEM/DECISIONS.md)

# Architectural Decision Records — Generated Digest

> **GENERATED — do not edit.** Run `node scripts/gen-adr-readme.mjs` to regenerate.
> Canonical ADR source: `docs/ADR/` — see [docs/ADR/README.md](../ADR/README.md) for the full index.
> Historical prose log preserved in git history prior to consolidation (2026-06-02).

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | [AGENTS.md as canonical governance source](../ADR/001-agents-md-canonical.md) | Accepted | 2026-05-20 |
| 002 | [Thin pointer pattern for tool overlays](../ADR/002-thin-pointer-pattern.md) | Accepted | 2026-05-20 |
| 003 | [gh CLI as required dependency for GitHub features](../ADR/003-gh-cli-required.md) | Accepted | 2026-05-20 |
| 004 | [skipIfExists on hooks, rules, and commands](../ADR/004-skip-if-exists.md) | Accepted | 2026-05-20 |
| 005 | [Deep merge for settings.json](../ADR/005-deep-merge-settings.md) | Accepted | 2026-05-20 |
| 006 | [TypeScript + Node for the CLI runtime](../ADR/006-typescript-node-cli.md) | Accepted | 2026-05-20 |
| 007 | [15 standard labels as canonical set](../ADR/007-standard-labels.md) | Accepted | 2026-05-20 |
| 008 | [Governance levels L1/L2/L3](../ADR/008-governance-levels.md) | Accepted | 2026-05-20 |
| 009 | [EJS over Handlebars (and other template engines)](../ADR/009-ejs-over-handlebars.md) | Accepted | 2026-05-20 |
| 010 | [ai-rulez coexistence — detect and skip tool configs](../ADR/010-ai-rulez-coexistence.md) | Accepted | 2026-05-20 |
| 011 | [Brownfield-first design — conflict resolution from day one](../ADR/011-brownfield-first-design.md) | Accepted | 2026-05-20 |
| 012 | [3-layer documentation enforcement](../ADR/012-doc-enforcement.md) | Accepted | 2026-05-20 |
| 013 | [Fixture-based per-claim testing](../ADR/013-testing-matrix.md) | Accepted | 2026-05-20 |
| 014 | [Tech Debt Prevention Strategy — Foundation-First Milestone Resequencing](../ADR/014-tech-debt-prevention-strategy.md) | Accepted | 2026-05-20 |
| 015 | [Debt Ratchet — Baseline-Anchored Regression Prevention](../ADR/015-debt-ratchet.md) | Accepted | 2026-05-20 |
| 016 | [RestAssured + Mutation Testing — 3-Layer Java Enforcement](../ADR/016-restassured-mutation-testing.md) | Accepted | 2026-05-20 |
| 017 | [Skills & Sub-Agents Generation (M19)](../ADR/017-skills-agents-generation.md) | Accepted | 2026-05-20 |
| 018 | [SSOT Framework Generation (M20)](../ADR/018-ssot-framework-generation.md) | Accepted | 2026-05-20 |
| 019 | [Richer GitHub Integration (M21)](../ADR/019-richer-github-integration.md) | Accepted | 2026-05-20 |
| 020 | [CLI-first over MCP for tool integrations](../ADR/020-cli-first-over-mcp.md) | Accepted | 2026-05-20 |
| 021 | [Archetype Axis and Architecture Style Knob](../ADR/021-archetype-axis.md) | Accepted | 2026-05-20 |
| 022 | [Universal Baseline-Freeze (MB)](../ADR/022-universal-baseline-freeze.md) | Accepted | 2026-05-20 |
| 023 | [Self-Hosted CI Runner (docker-ci-build)](../ADR/023-self-hosted-ci-runner.md) | Accepted | 2026-05-20 |
| 024 | [Suppression Pattern with Mandatory Expiry](../ADR/024-suppression-expiry-escape-hatch.md) | Accepted | 2026-05-20 |
| 025 | [Claim-Verified Governance Documents](../ADR/025-claim-verified-governance-docs.md) | Accepted | 2026-05-20 |
| 026 | [Scaled Thresholds and Practical/Pedantic Strictness Tiers](../ADR/026-scaled-thresholds.md) | Accepted | 2026-05-20 |
| 027 | [Real-Project Nightly Matrix](../ADR/027-real-project-nightly-matrix.md) | Accepted | 2026-05-20 |
| 028 | [Grace Period for Level Upgrade + Contract Type Axis](../ADR/028-level-upgrade-grace-and-contract-type.md) | Accepted | 2026-05-20 |
| 029 | [Mutation Testing as Hard L3 Gate — Multi-Stack, 85% Threshold](../ADR/029-mutation-testing-hard-gate.md) | Accepted | 2026-05-20 |
| 030 | [Nightly Pipeline & Evidence Harness](../ADR/030-nightly-evidence-harness.md) | Accepted | 2026-05-20 |
| 031 | [Plugin API v1](../ADR/031-plugin-api-v1.md) | Accepted | 2026-05-20 |
| 032 | [Hook Hardness Manifest and Empirical Verification (INV-36)](../ADR/032-hook-hardness-manifest.md) | Accepted | 2026-05-20 |
| 033 | [Generated Githooks for All Language Stacks (INV-37)](../ADR/033-githooks-multi-stack.md) | Accepted | 2026-05-20 |
| 034 | [Phase-Tracked Lifecycle Hard Enforcement](../ADR/034-phase-lifecycle-hard-enforcement.md) | Accepted | 2026-05-20 |
| 035 | [Pluggable Decomposition Backend](../ADR/035-pluggable-decomposition-backend.md) | Accepted | 2026-05-20 |
| 036 | [Lane/Track Awareness for Multi-Layer Projects](../ADR/036-lane-awareness.md) | Accepted | 2026-05-20 |
| 037 | [Evidence Harness for Target Projects](../ADR/037-evidence-harness-target-projects.md) | Accepted | 2026-05-20 |
| 038 | [Mission Elevation — v1.0 Scope](../ADR/038-mission-elevation-v1.md) | Accepted | 2026-05-20 |
| 039 | [V1 Verification Bridge](../ADR/039-verification-bridge-v1.md) | Accepted | 2026-05-20 |
| 040 | [Provenance Graph as a first-class primitive](../ADR/040-provenance-graph-primitive.md) | Accepted | 2026-05-20 |
| 041 | [Task Workflow via /task Slash Command](../ADR/041-task-workflow.md) | deprecated | 2026-06-05 |
| 042 | [Three-Tier Gate System (L1/L2/L3)](../ADR/042-gate-tiers.md) | Accepted | 2026-05-20 |
| 043 | [Docs Site Information Architecture](../ADR/043-docs-site-ia.md) | Accepted | 2026-05-20 |
| 044 | [Docs Site Versioning Strategy](../ADR/044-docs-versioning.md) | Accepted | 2026-05-20 |
| 045 | [KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract](../ADR/045-kit-taxonomy.md) | Accepted | 2026-05-20 |
| 046 | [Stack Adapter Model](../ADR/046-stack-adapter.md) | Accepted | 2026-05-20 |
| 047 | [Security Scanning Suite (M24)](../ADR/047-security-scanning.md) | Accepted | 2026-05-20 |
| 048 | [Plugin API v1.1 — Scaffolder and Memory Interface](../ADR/048-plugin-api-v1.1-scaffolder.md) | Accepted | 2026-05-20 |
| 049 | [Java Static Analysis: Baseline Audit and Wiring Fixes](../ADR/049-java-static-analysis-baseline.md) | Accepted | 2026-05-20 |
| 050 | [Pipeline Complexity Tiers — Archetype-Default + Governance Floor](../ADR/050-pipeline-complexity-tiers.md) | Accepted | 2026-05-23 |
| 051 | [Collaboration-Mode Axis — Branching, CI Shape, and Merge Policy](../ADR/051-collaboration-mode-workflow-axis.md) | Accepted | 2026-05-28 |
| 052 | [Fast-Forward Merge Policy and Cosign SHA Preservation](../ADR/052-fast-forward-merge-cosign-preservation.md) | Accepted | 2026-05-28 |
| 053 | [CI Gap Closures, Per-Tier Nightly, Opt-In Selective Gates, and Local Provenance Log](../ADR/053-ci-gap-closures-and-check-ladder.md) | Accepted | 2026-05-28 |
| 054 | [Phase 3.5 handoff modeled as status.json fields (#703, 2026-05-18)](../ADR/054-phase-3-5-handoff-modeled-as-status-json-fields.md) | Accepted | 2026-05-31 |
| 055 | [SpotBugs security hard-block baseline script (#212)](../ADR/055-spotbugs-security-hard-block-baseline-script.md) | Accepted | 2026-05-31 |
| 056 | [Self-dogfood check for EJS templates (#239)](../ADR/056-self-dogfood-check-for-ejs-templates.md) | Accepted | 2026-05-31 |
| 057 | [V1 Verification Bridge (#253)](../ADR/057-v1-verification-bridge.md) | Accepted | 2026-05-31 |
| 058 | [Context-economy rule + knowledge-map + track-aware post-commit (#720, #724)](../ADR/058-context-economy-rule-knowledge-map-track-aware-post-commit.md) | Accepted | 2026-05-31 |
| 059 | [selfOnly invariant field — filter arbiter-internal rules from generated target AGENTS.md (#682)](../ADR/059-selfonly-invariant-field-filter-arbiter-internal-rules-from.md) | Accepted | 2026-05-31 |
| 060 | [alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)](../ADR/060-alwaysactive-semantics-clarification-inv-29-30-asymmetry-rat.md) | Accepted | 2026-06-30 |
| 061 | [Batch-execution safety rule for parallel agents (#722, 2026-05-16)](../ADR/061-batch-execution-safety-rule-for-parallel-agents.md) | Accepted | 2026-05-31 |
| 062 | [CLI catalog docs/COMMANDS.md generation (#728, 2026-05-16)](../ADR/062-cli-catalog-docs-commands-m

*[content truncated — see source for full text]*
