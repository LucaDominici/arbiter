---
title: 'Arbiter — ADR Index & Gap Register'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'ADR-INDEX'
tags: ['audience/dev', 'kind/adr', 'kind/architecture']
related:
  ['docs/architecture/arc42.md', 'docs/internal/ADR/README.md', 'docs/internal/SYSTEM/DECISIONS.md']
---

# Arbiter — ADR Index & Gap Register

A catalogue of arbiter's **Architecture Decision Records** — current count in `docs/internal/ADR/`
or the generated row count in
[`docs/internal/SYSTEM/DECISIONS.md`](../internal/SYSTEM/DECISIONS.md) — one line each, plus a
**gap register** flagging architecturally-significant decisions that have _no_ ADR. This is a
navigation aid over the canonical source — the generated digest is
[`docs/internal/SYSTEM/DECISIONS.md`](../internal/SYSTEM/DECISIONS.md); the canonical per-ADR files
live in [`docs/internal/ADR/`](../internal/ADR/).

> Statuses are copied from the ADR frontmatter / DECISIONS digest. `dep` = deprecated,
> `prop` = proposed. Everything else is Accepted.

## Themes at a glance

| Theme                                      | ADRs                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Canonical source model & tool overlays     | 001, 002, 004, 005, 010, 011, 059, 060, 089, 095, 100                     |
| CLI runtime & plugin/API surface           | 003, 006, 020, 031, 048, 062, 068, 084, 096, 097, 098, 099                |
| Governance levels, gate tiers & thresholds | 008, 026, 028, 042, 050, 053, 076, 091, 092, 102, 104                     |
| Task lifecycle & agent orchestration       | 025, 034, 038, 039, 041(dep), 054, 057, 058, 061, 067, 077, 088, 090, 093 |
| Testing, evidence & provenance             | 012, 013, 016, 029, 030, 037, 040, 063, 070, 081, 082, 083, 086           |
| Generation axes, stacks & adapters         | 021, 022, 033, 046, 049, 051, 055, 072, 073, 087, 094, 101                |
| Security & compliance                      | 024, 047, 069, 078                                                        |
| KIT taxonomy                               | 045, 066                                                                  |
| Docs site & doc-governance                 | 017, 018, 019, 043, 044, 075, 080                                         |
| Tech-debt & anti-drift discipline          | 014, 015, 032, 036, 074, 079, 085                                         |

## Full catalogue (one line each)

| #   | Decision (one line)                                                                              | Status         |
| --- | ------------------------------------------------------------------------------------------------ | -------------- |
| 001 | `AGENTS.md` is the single canonical governance source                                            | Accepted       |
| 002 | Thin-pointer pattern for per-tool overlays (no duplicated governance)                            | Accepted       |
| 003 | `gh` CLI is a required dependency for GitHub features                                            | Accepted       |
| 004 | `skipIfExists` on hooks, rules, commands (never overwrite customization)                         | Accepted       |
| 005 | Deep-merge strategy for `settings.json`                                                          | Accepted       |
| 006 | TypeScript + Node for the CLI runtime                                                            | Accepted       |
| 007 | 15 standard labels as the canonical GitHub label set                                             | Accepted       |
| 008 | Governance levels L1/L2/L3 (and the L1 ⊂ L2 ⊂ L3 nesting)                                        | Accepted       |
| 009 | EJS over Handlebars and other template engines                                                   | Accepted       |
| 010 | ai-rulez coexistence — detect and skip tool-config generation                                    | Accepted       |
| 011 | Brownfield-first design — conflict resolution from day one                                       | Accepted       |
| 012 | 3-layer documentation enforcement                                                                | Accepted       |
| 013 | Fixture-based per-claim (compatibility-matrix) testing                                           | Accepted       |
| 014 | Tech-debt prevention via foundation-first milestone resequencing                                 | Accepted       |
| 015 | Debt ratchet — baseline-anchored regression prevention                                           | Accepted       |
| 016 | RestAssured + mutation testing — 3-layer Java enforcement                                        | Accepted       |
| 017 | Skills & sub-agents generation                                                                   | Accepted       |
| 018 | SSOT framework generation                                                                        | Accepted       |
| 019 | Richer GitHub integration                                                                        | Accepted       |
| 020 | CLI-first over MCP for tool integrations                                                         | Accepted       |
| 021 | Archetype axis and architecture-style knob                                                       | Accepted       |
| 022 | Universal baseline-freeze                                                                        | Accepted       |
| 023 | Self-hosted CI runner (docker-ci-build)                                                          | Accepted       |
| 024 | Suppression pattern with mandatory expiry                                                        | Accepted       |
| 025 | Claim-verified governance documents                                                              | Accepted       |
| 026 | Scaled thresholds + practical/pedantic strictness tiers                                          | Accepted       |
| 027 | Real-project nightly matrix                                                                      | Accepted       |
| 028 | Grace period for level upgrade + contract-type axis                                              | Accepted       |
| 029 | Mutation testing as a hard L3 gate (multi-stack, 85 %)                                           | Accepted       |
| 030 | Nightly pipeline & evidence harness                                                              | Accepted       |
| 031 | Plugin API v1                                                                                    | Accepted       |
| 032 | Hook hardness manifest + empirical verification (INV-36)                                         | Accepted       |
| 033 | Generated githooks for all language stacks (INV-37)                                              | Accepted       |
| 034 | Phase-tracked lifecycle hard enforcement                                                         | Accepted       |
| 035 | Pluggable decomposition backend (github / markdown) — _consumer command since pruned, see §11.4_ | Accepted       |
| 036 | Lane/track awareness for multi-layer projects                                                    | Accepted       |
| 037 | Evidence harness for target projects                                                             | Accepted       |
| 038 | Mission elevation — v1.0 scope                                                                   | Accepted       |
| 039 | V1 verification bridge                                                                           | Accepted       |
| 040 | Provenance graph as a first-class primitive                                                      | Accepted       |
| 041 | Task workflow via `/task` slash command — **superseded by `/ship` (ADR-088)**                    | **deprecated** |
| 042 | Three-tier gate system (L1/L2/L3)                                                                | Accepted       |
| 043 | Docs site information architecture                                                               | Accepted       |
| 044 | Docs site versioning strategy                                                                    | Accepted       |
| 045 | KIT taxonomy — wrap-not-replace, field cross-walk, parity contract                               | Accepted       |
| 046 | Stack adapter model — _self-scaffold since retired (#1837)_                                      | Accepted       |
| 047 | Security scanning suite                                                                          | Accepted       |
| 048 | Plugin API v1.1 — scaffolder + memory interface                                                  | Accepted       |
| 049 | Java static analysis — baseline audit & wiring fixes                                             | Accepted       |
| 050 | Pipeline complexity tiers — archetype-default + governance floor                                 | Accepted       |
| 051 | Collaboration-mode axis — branching, CI shape, merge policy                                      | Accepted       |
| 052 | Fast-forward merge policy + cosign SHA preservation                                              | Accepted       |
| 053 | CI gap closures, per-tier nightly, opt-in selective gates, local provenance log                  | Accepted       |
| 054 | Phase-3.5 handoff modeled as `status.json` fields                                                | Accepted       |
| 055 | SpotBugs security hard-block baseline script                                                     | Accepted       |
| 056 | Self-dogfood check for EJS templates                                                             | Accepted       |
| 057 | V1 verification bridge (impl)                                                                    | Accepted       |
| 058 | Context-economy rule + knowledge-map + track-aware post-commit                                   | Accepted       |
| 059 | `selfOnly` invariant field — filter arbiter-internal rules from generated AGENTS.md              | Accepted       |
| 060 | `alwaysActive` semantics + INV-29/30 asymmetry rationale                                         | Accepted       |
| 061 | Batch-execution safety rule for parallel agents                                                  | Accepted       |
| 062 | CLI catalog `docs/COMMANDS.md` generation                                                        | Accepted       |
| 063 | `check-no-skipped-tests` hook (NI-11 enforcement)                                                | Accepted       |
| 064 | Observability provider abstraction                                                               | Accepted       |
| 065 | Auth provider abstraction                                                                        | Accepted       |
| 066 | Industrial-grade meta-preset                                                                     | Accepted       |
| 067 | Worktree harvest parent-state guardrails                                                         | Accepted       |
| 068 | Wizard Ctrl+C abort — exit 130, tmp cleanup, unified message                                     | Accepted       |
| 069 | Action-pin parity — dependabot bypass fix                                                        | Accepted       |
| 070 | Toolchain audit generator — evidence bundle                                                      | Accepted       |
| 071 | k6 performance-testing ecosystem template                                                        | Accepted       |
| 072 | Loud-bypass contract library                                                                     | Accepted       |
| 073 | Frontend governance generator — FrontendConfig + skipIfExists policy                             | Accepted       |
| 074 | Risk register + P×I assessment template                                                          | Accepted       |
| 075 | Docs site IA v2 — outcome-first navigation                                                       | Accepted       |
| 076 | CANON-22 — evidence-based quality gating + gate un-blinding                                      | Accepted       |
| 077 | Agent registry introduction                                                                      | Accepted       |
| 078 | ISO 27001 / NIS2 / GDPR compliance gate mapping                                                  | Accepted       |
| 079 | Red-team SSOT alignment checks                                                                   | Accepted       |
| 080 | Operations handbook generator                                                                    | Accepted       |
| 081 | 25-dimension test taxonomy extension                                                             | Accepted       |
| 082 | MCP fallback determinism rule + cross-language skip-test guard                                   | Accepted       |
| 083 | Matrix downgrade-vs-fix verdict — HALF/FAKE proven cells                                         | Accepted       |
| 084 | User-toggle catalog preconditions + UX scaffold                                                  | **proposed**   |
| 085 | Evidence prune script + red-team SSOT alignment vectors                                          | Accepted       |
| 086 | Four-pillar SSOT infrastructure                                                                  | Accepted       |
| 087 | Rust context-aware INV-04 checkers + rebased-aware docs-check                                    | Accepted       |
| 088 | `/ship` as the single orchestration entrypoint                                                   | Accepted       |
| 089 | Collapse hand docs to SSOT-core + generated LLM-Wiki                                             | Accepted       |
| 090 | Workflow performance budget                                                                      | Accepted       |
| 091 | Single-developer exception attestation (§11.10(k))                                               | Accepted       |
| 092 | jscpd v5 migration — fail-closed duplication gate                                                | Accepted       |
| 093 | Dual-side the `/ship` orchestrator (consumer-safe)                                               | **proposed**   |
| 094 | Project profile resolver — one catalog + one precedence layer                                    | **proposed**   |
| 095 | Supported AI tools — claude + codex; rest experimental                                           | Accepted       |
| 096 | Probe — always-on incidental-discovery loop                                                      | Accepted       |
| 097 | Context-rot-management skill (CLI-first 3-layer redundancy)                                      | Accepted       |
| 098 | Progressive-adoption tiers (bootstrap on-ramp)                                                   | Accepted       |
| 099 | Native zero-dependency xlsx writer (drop exceljs)                                                | Accepted       |
| 100 | Companion-plugin awareness in `/ship`                                                            | Accepted       |
| 101 | `runnerProfile` cadence axis (solo/fleet)                                                        | Accepted       |
| 102 | Gate the workflow-template-emitted dims at L3                                                    | Accepted       |
| 104 | Trivy fs replaces OWASP Dependency-Check for JVM dependency scanning                             | Accepted       |

_(There is no ADR-103 — see the gap register below.)_

## Gap register — architecturally-significant decisions with no ADR

These are real, load-bearing design decisions the codebase relies on but that are **not** recorded as
ADRs. Flagged, not invented — each should get a written ADR (reconstructed from the cited source, not
fabricated).

| Gap                                                            | What it is                                                                                                                                                                                                                                              | Where it's decided today                                                                                    | Severity                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **ADR-103 (missing file)**                                     | The parallel write-agent worktree carve-out (dedicated worktree + distinct branch + disjoint file-sets) and the `gate-lock ≺ worktree-lock ≺ wave-claim` order. Cited by number across `cli.ts`, `50-batch-execution.md`, `wave-drain`, `gate-exec.ts`. | `src/templates/claude/rules/50-batch-execution.md` + `gate-exec.ts` comments                                | **High** — a numbered ADR is referenced but absent; the index skips 102→104.               |
| **"No new TS engine" / B-prune (#1817)**                       | The deliberate removal of the affinity/sizing/cost/decomposition/batch engines (−11,423 LOC) and the decision to keep multi-issue clustering & orchestration **model-side**. A major architectural reversal.                                            | `CHANGELOG.md:167-186`, `docs/REFERENCE/wave-primitives.md:13-16`                                           | **High** — the single biggest structural decision in the repo's recent history has no ADR. |
| **Weighted auditor-routing verdict model**                     | The 7-auditor weighting, `always_on` floor, glob `tag_map`, and the `score = Σw(pass)/Σw(all)` anti-inflation math + red-team caps.                                                                                                                     | `.claude/auditor-routing.json`, `.claude/commands/review-code.md`; partially under ADR-077 (agent registry) | **Medium** — the core review-dispatch math is config + prose, not an ADR.                  |
| **`agent-dispatch-matrix` as drift-proof oracle**              | The `tier × track × review_mode × pr_type` UNION-only resolution asserted equal to `verticalsForTier`.                                                                                                                                                  | `.claude/agent-dispatch-matrix.json`, `scripts/check-agent-dispatch.mjs`                                    | **Medium**                                                                                 |
| **Dual conformance engines (typed TS ↔ `.mjs` reference)**     | Two intentionally-parallel scoring engines kept deep-equal by a parity test.                                                                                                                                                                            | `src/conformance/engine.ts` vs `scripts/lib/gold-audit-lib.mjs`                                             | **Low** — powerful but undocumented as a decision.                                         |
| **INV-114 fail-closed Stop gate (three-artifact correlation)** | The completion-claim guard is the spine of "can't fake green" but is an invariant, not an ADR.                                                                                                                                                          | `src/invariants/catalog.ts` (INV-114), `stop-evidence-guard.mjs`                                            | **Low** — well-enforced, just not ADR-recorded.                                            |

## Process note

New ADRs use `docs/internal/ADR/ADR-TEMPLATE.md`; the digest
(`docs/internal/SYSTEM/DECISIONS.md`) is generated by `scripts/gen-adr-readme.mjs` and is
gate-checked for drift (INV-107). An architectural change qualifies for an ADR when it changes a
public API, the dual-track contract, a governance threshold, the SSOT layering, an external
dependency, or reverses a prior ADR (ARCHITECTURE.md §"When to file an ADR").
