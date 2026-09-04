---
title: 'Architectural Decision Records — Generated Digest'
doc_version: '1.0.0'
status: generated
last_review: '2026-09-04'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# Architectural Decision Records — Generated Digest

> **GENERATED — do not edit.** Run `node scripts/gen-adr-readme.mjs` to regenerate.
> Canonical ADR source: `docs/internal/ADR/` — see [docs/internal/ADR/README.md](../ADR/README.md) for the full index.
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
| 007 | [14 standard labels as canonical set](../ADR/007-standard-labels.md) | Accepted | 2026-08-29 |
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
| 023 | [Self-Hosted CI Runner (docker-ci-build)](../ADR/023-self-hosted-ci-runner.md) | superseded | 2026-07-04 |
| 024 | [Suppression Pattern with Mandatory Expiry](../ADR/024-suppression-expiry-escape-hatch.md) | Accepted | 2026-05-20 |
| 025 | [Claim-Verified Governance Documents](../ADR/025-claim-verified-governance-docs.md) | Accepted | 2026-07-01 |
| 026 | [Scaled Thresholds and Practical/Pedantic Strictness Tiers](../ADR/026-scaled-thresholds.md) | Accepted | 2026-05-20 |
| 027 | [Real-Project Nightly Matrix](../ADR/027-real-project-nightly-matrix.md) | Accepted | 2026-05-20 |
| 028 | [Grace Period for Level Upgrade + Contract Type Axis](../ADR/028-level-upgrade-grace-and-contract-type.md) | Accepted | 2026-05-20 |
| 029 | [Mutation Testing as Hard L3 Gate — Multi-Stack, 85% Threshold](../ADR/029-mutation-testing-hard-gate.md) | superseded | 2026-07-12 |
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
| 045 | [KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract](../ADR/045-kit-taxonomy.md) | Accepted | 2026-07-10 |
| 046 | [Stack Adapter Model](../ADR/046-stack-adapter.md) | Accepted | 2026-05-20 |
| 047 | [Security Scanning Suite (M24)](../ADR/047-security-scanning.md) | Accepted | 2026-05-20 |
| 048 | [Plugin API v1.1 — Scaffolder and Memory Interface](../ADR/048-plugin-api-v1.1-scaffolder.md) | Accepted | 2026-05-20 |
| 049 | [Java Static Analysis: Baseline Audit and Wiring Fixes](../ADR/049-java-static-analysis-baseline.md) | Accepted | 2026-05-20 |
| 050 | [Pipeline Complexity Tiers — Archetype-Default + Governance Floor](../ADR/050-pipeline-complexity-tiers.md) | Accepted | 2026-05-23 |
| 051 | [Collaboration-Mode Axis — Branching, CI Shape, and Merge Policy](../ADR/051-collaboration-mode-workflow-axis.md) | Accepted | 2026-05-28 |
| 052 | [Exact-SHA Landing and Cosign Preservation](../ADR/052-fast-forward-merge-cosign-preservation.md) | Accepted | 2026-09-04 |
| 053 | [CI Gap Closures, Per-Tier Nightly, Opt-In Selective Gates, and Local Provenance Log](../ADR/053-ci-gap-closures-and-check-ladder.md) | Accepted | 2026-05-28 |
| 054 | [Phase 3.5 handoff modeled as status.json fields (#703, 2026-05-18)](../ADR/054-phase-3-5-handoff-modeled-as-status-json-fields.md) | Accepted | 2026-05-31 |
| 055 | [SpotBugs security hard-block baseline script (#212)](../ADR/055-spotbugs-security-hard-block-baseline-script.md) | Accepted | 2026-05-31 |
| 056 | [Self-dogfood check for EJS templates (#239)](../ADR/056-self-dogfood-check-for-ejs-templates.md) | Accepted | 2026-05-31 |
| 057 | [V1 Verification Bridge (#253)](../ADR/057-v1-verification-bridge.md) | Accepted | 2026-05-31 |
| 058 | [Context-economy rule + knowledge-map + track-aware post-commit (#720, #724)](../ADR/058-context-economy-rule-knowledge-map-track-aware-post-commit.md) | Accepted | 2026-05-31 |
| 059 | [selfOnly invariant field — filter arbiter-internal rules from generated target AGENTS.md (#682)](../ADR/059-selfonly-invariant-field-filter-arbiter-internal-rules-from.md) | Accepted | 2026-05-31 |
| 060 | [alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)](../ADR/060-alwaysactive-semantics-clarification-inv-29-30-asymmetry-rat.md) | Accepted | 2026-06-30 |
| 061 | [Batch-execution safety rule for parallel agents (#722, 2026-05-16)](../ADR/061-batch-execution-safety-rule-for-parallel-agents.md) | Accepted | 2026-05-31 |
| 062 | [CLI catalog docs/COMMANDS.md generation (#728, 2026-05-16)](../ADR/062-cli-catalog-docs-commands-md-generation.md) | Accepted | 2026-05-31 |
| 063 | [check-no-skipped-tests hook (NI-11 enforcement) (#730)](../ADR/063-check-no-skipped-tests-hook-ni-11-enforcement.md) | Accepted | 2026-05-31 |
| 064 | [Observability provider abstraction (#725)](../ADR/064-observability-provider-abstraction.md) | Accepted | 2026-05-31 |
| 065 | [Auth provider abstraction (#726)](../ADR/065-auth-provider-abstraction.md) | Accepted | 2026-05-31 |
| 066 | [Industrial-grade meta-preset (#729)](../ADR/066-industrial-grade-meta-preset.md) | Accepted | 2026-05-31 |
| 067 | [Worktree harvest parent-state guardrails (#733)](../ADR/067-worktree-harvest-parent-state-guardrails.md) | Accepted | 2026-05-31 |
| 068 | [Wizard Ctrl+C abort — exit 130, tmp cleanup, unified message (#621)](../ADR/068-wizard-ctrl-c-abort-exit-130-tmp-cleanup-unified-message.md) | Accepted | 2026-05-31 |
| 069 | [Action pin parity — dependabot bypass fix (#911)](../ADR/069-action-pin-parity-dependabot-bypass-fix.md) | Accepted | 2026-05-31 |
| 070 | [Toolchain audit generator — W11 evidence bundle (#887)](../ADR/070-toolchain-audit-generator-w11-evidence-bundle.md) | Accepted | 2026-05-31 |
| 071 | [F6 — k6 performance testing ecosystem template (#895)](../ADR/071-f6-k6-performance-testing-ecosystem-template.md) | Accepted | 2026-05-31 |
| 072 | [Loud-bypass contract library (Workstream C Port #10, #970)](../ADR/072-loud-bypass-contract-library-workstream-c-port-10-970.md) | Accepted | 2026-05-31 |
| 073 | [Frontend Governance Generator — FrontendConfig + skipIfExists policy](../ADR/073-frontend-governance-generator-frontendconfig-skipifexists-po.md) | Accepted | 2026-05-31 |
| 074 | [Risk register + P×I assessment template](../ADR/074-risk-register-p-i-assessment-template.md) | Accepted | 2026-05-31 |
| 075 | [Docs Site Information Architecture v2 — Outcome-First Navigation](../ADR/075-docs-site-ia-v2.md) | Accepted | 2026-06-01 |
| 076 | [CANON-22 — evidence-based quality gating + gate un-blinding](../ADR/076-canon-22-evidence-based-quality.md) | Accepted | 2026-06-01 |
| 077 | [Agent Registry Introduction](../ADR/077-agent-registry-introduction.md) | Accepted | 2026-05-17 |
| 078 | [ISO 27001 / NIS2 / GDPR Compliance Gate Mapping](../ADR/078-compliance-gate-mapping-iso27001-nis2-gdpr.md) | Accepted | 2026-05-16 |
| 079 | [Red-Team SSOT Alignment Checks](../ADR/079-red-team-ssot-alignment-checks.md) | Accepted | 2026-05-16 |
| 080 | [Operations Handbook Generator](../ADR/080-operations-handbook-generator.md) | Accepted | 2026-05-16 |
| 081 | [25-Dimension Test Taxonomy Extension](../ADR/081-25-dimension-test-taxonomy-extension.md) | Accepted | 2026-05-16 |
| 082 | [MCP Fallback Determinism Rule and Cross-Language Skip-Test Guard](../ADR/082-mcp-fallback-determinism-and-skip-test-guard.md) | Accepted | 2026-05-16 |
| 083 | [Matrix Downgrade-vs-Fix Verdict — 7 HALF/FAKE Proven Cells](../ADR/083-matrix-downgrade-vs-fix-verdict.md) | Accepted | 2026-05-14 |
| 084 | [User-Toggle Catalog Preconditions and UX Scaffold](../ADR/084-user-toggle-catalog-preconditions.md) | proposed | 2026-05-14 |
| 085 | [Evidence Prune Script and Red-Team SSOT Alignment Vectors](../ADR/085-evidence-prune-and-red-team-ssot-alignment-vectors.md) | Accepted | 2026-05-16 |
| 086 | [Four-Pillar SSOT Infrastructure (AC#1 Deviation)](../ADR/086-four-pillar-ssot-infrastructure.md) | Accepted | 2026-05-13 |
| 087 | [Rust Context-Aware INV-04 Checkers and Rebased-Aware Docs-Check](../ADR/087-rust-context-aware-inv04-checkers-and-rebased-docs-check.md) | Accepted | 2026-05-14 |
| 088 | [/ship as the Single Orchestration Entrypoint](../ADR/088-ship-as-orchestration-entrypoint.md) | Accepted | 2026-06-05 |
| 089 | [Collapse hand docs to SSOT-core + generated LLM-Wiki](../ADR/089-collapse-hand-docs-to-ssot-core-plus-generated-wiki.md) | Accepted | 2026-06-06 |
| 090 | [Workflow Performance Budget](../ADR/090-workflow-performance-budget.md) | Accepted | 2026-06-07 |
| 091 | [Single-Developer Exception Attestation (§11.10(k))](../ADR/091-single-dev-exception-attestation.md) | Accepted | 2026-06-07 |
| 092 | [jscpd v5 Migration — Fail-Closed Duplication Gate](../ADR/092-jscpd-v5-fail-closed-duplication-gate.md) | Accepted | 2026-06-10 |
| 093 | [Dual-Side the /ship Orchestrator](../ADR/093-dual-side-ship-orchestrator.md) | proposed | 2026-06-11 |
| 094 | [Project Profile Resolver — one catalog + one precedence layer](../ADR/094-project-profile-resolver.md) | proposed | 2026-06-11 |
| 095 | [Supported AI tools — claude + codex; rest experimental](../ADR/095-supported-ai-tools-claude-codex.md) | accepted | 2026-06-13 |
| 096 | [Probe — always-on incidental-discovery loop](../ADR/096-probe-incidental-discovery-loop.md) | accepted | 2026-06-15 |
| 097 | [Context-rot-management skill (CLI-first 3-layer redundancy)](../ADR/097-context-rot-management-skill.md) | accepted | 2026-06-19 |
| 098 | [Progressive-adoption tiers (bootstrap on-ramp)](../ADR/098-progressive-adoption-tiers.md) | Accepted | 2026-06-20 |
| 099 | [Native zero-dependency xlsx writer (drop exceljs)](../ADR/099-native-xlsx-writer.md) | Accepted | 2026-06-30 |
| 100 | [Companion-plugin awareness in /ship](../ADR/100-companion-plugin-awareness.md) | accepted | 2026-07-01 |
| 101 | [runnerProfile cadence axis (solo/fleet)](../ADR/101-runner-profile-cadence-axis.md) | Accepted | 2026-07-01 |
| 102 | [gate the workflow-template-emitted dims at L3](../ADR/102-l3-workflow-dim-gating.md) | Accepted | 2026-07-01 |
| 103 | [Worktree-Isolated Parallel Execution Carve-out](../ADR/103-worktree-parallel-carveout.md) | Accepted | 2026-08-23 |
| 104 | [Trivy fs replaces OWASP Dependency-Check for JVM dependency scanning](../ADR/104-trivy-fs-replaces-owasp-dependency-check.md) | Accepted | 2026-07-10 |
| 105 | [never-brick config migration — coercible vs fatal fields](../ADR/105-never-brick-config-migration.md) | Accepted | 2026-07-11 |
| 106 | [Codex-track parity contract — derive-from-Claude + gate-enforced parity surface](../ADR/106-codex-track-parity-contract.md) | Accepted | 2026-07-16 |
| 107 | [arbiter obsidian subcommand — thin generic orchestrator](../ADR/107-obsidian-subcommand.md) | Accepted | 2026-07-17 |
| 108 | [Exact-SHA landing for evidence-bearing PRs](../ADR/108-ff-only-merge-method-evidence-bearing-prs.md) | Accepted | 2026-07-27 |
| 109 | [constraint-map.json scaffolded + INV-115 fail-closed on a missing map](../ADR/109-constraint-map-fail-closed.md) | Accepted | 2026-07-20 |
| 110 | [Acceptance-criteria anchor — entry gate, external DoD, FIT review, rework telemetry](../ADR/110-acceptance-criteria-anchor.md) | Accepted | 2026-07-21 |
| 111 | [tier origination is human-only (#2184, follow-up to #2180/#2178)](../ADR/111-tier-origination-human-only.md) | Accepted | 2026-08-03 |
| 112 | [project-declared invariants (PROJ-NN) — the project is the author of its own catalog additions (#2035)](../ADR/112-project-invariants-proj-nn.md) | Accepted | 2026-08-04 |
| 113 | [decision registry (D-NN) — blocked project decisions with per-decision enforcement (#2036)](../ADR/113-decision-registry-dnn.md) | Accepted | 2026-08-04 |
| 114 | [extended-set activation + live-SSOT drift binding (#2044)](../ADR/114-extended-invariants-live-ssot.md) | Accepted | 2026-08-04 |
| 115 | [Bounded Sealed Trains — When a Batch Stops Taking Issues](../ADR/115-bounded-sealed-trains.md) | Accepted | 2026-08-22 |
| 116 | [Evidence Binds to Source Content; the Train Is the Ceremony Unit; a PR Is Owned Until Merged](../ADR/116-evidence-content-binding-train-ceremony-pr-ownership.md) | Accepted | 2026-08-29 |
| 117 | [Companion Skill Provenance — Detected, Never Bundled](../ADR/117-companion-skill-provenance.md) | Accepted | 2026-08-29 |
