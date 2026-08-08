---
title: 'Arbiter — Feasibility Study'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'FEASIBILITY'
tags: ['audience/dev', 'kind/reference']
related: ['docs/architecture/arc42.md', 'docs/PRODUCT/PRD.md']
---

# Arbiter — Feasibility Study

A retroactive **TELOS-lite** (Technical / Economic / Legal / Operational / Schedule) record of why
arbiter was built the way it was. Written in past tense — this is a justification record, not a
prediction. Legal: N/A (no regulated data; see [`PRIVACY.md`](../../PRIVACY.md)). Every section
links its source instead of re-deriving it; see [`arc42.md`](arc42.md) for the architecture itself.

## Context & Trigger

AI coding tools each grew their own config format, and teams adopting them accumulated drift-prone,
manually-maintained duplicate rule sets (and no per-tool enforcement at edit time). Arbiter's
founding decision, [ADR-001](../internal/ADR/001-agents-md-canonical.md), picked `AGENTS.md` as the
single canonical governance source over per-tool files. See
[PRD.md §Problem](../PRODUCT/PRD.md#problem) for the full problem statement.

## Alternatives Considered

| Alternative                                                                 | Why rejected                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt [ai-rulez](https://github.com/isobar-ai/ai-rulez) instead of building | Never posed as a build-vs-adopt decision; the recorded call is operational coexistence — arbiter detects ai-rulez and skips tool-config generation, still emitting `AGENTS.md` ([ADR-010](../internal/ADR/010-ai-rulez-coexistence.md)) |
| Per-tool canonical configs (no single source)                               | Drift guaranteed, cross-tool consistency impossible ([ADR-001](../internal/ADR/001-agents-md-canonical.md) §Alternatives rejected)                                                                                                      |
| MCP servers as the integration surface                                      | No CI/bare-terminal portability, per-tool auth/config shape, protocol churn ([ADR-020](../internal/ADR/020-cli-first-over-mcp.md))                                                                                                      |
| Rust/Go single-binary CLI                                                   | Longer compile time, worse contributor DX, smaller ecosystem for this task than TS/Node ([ADR-006](../internal/ADR/006-typescript-node-cli.md) §Alternatives rejected)                                                                  |

## Technical Feasibility

Real constraints — solo dev, TS/Node-only runtime, CLI-first (no MCP dependency) — are recorded
against the chosen stack in [ADR-006](../internal/ADR/006-typescript-node-cli.md)
(runtime) and [ADR-020](../internal/ADR/020-cli-first-over-mcp.md) (integration surface).
[arc42.md §2](arc42.md#2-architecture-constraints) is the current constraint table (C1-C10); none
of it is re-derived here. CI topology (ADR-023) is covered under Operational Feasibility below,
since its "real constraint" was reversed 2026-05-20.

## Economic Feasibility

No NPV theater for a solo project: [ADR-010](../internal/ADR/010-ai-rulez-coexistence.md) is the
concrete instance — detect-and-skip kept `AGENTS.md` (the actual differentiator) buildable
independently of ai-rulez, at the cost of no merge or migration path (ADR-010 §Consequences). The
build-vs-adopt cost comparison is not recorded in any ADR.

## Operational Feasibility

One maintainer runs and maintains arbiter; no service, no on-call. Distribution and CI topology are
in [arc42.md §7](arc42.md#7-deployment-view). The self-hosted-runner decision
([ADR-023](../internal/ADR/023-self-hosted-ci-runner.md)) was reversed on 2026-05-20 (#959): arbiter's
own CI and every generated template now default to `ubuntu-latest`, with `CI_BUILD_RUNNER_LABEL` as
the override — warm caches lost the trade to zero-setup onboarding.
Gate-green evidence for every merge is the operational proof, not a separate claim — see
[arc42.md §6.3](arc42.md#63-completion-is-fail-closed-on-correlated-evidence-inv-114).

## Schedule (retroactive)

One line per shipped [PRD.md §Features by Phase](../PRODUCT/PRD.md#features-by-phase) phase:

| Phase                                           | Outcome                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4 (Core, GitHub, Update/Diff, Extended Tools) | Shipped v0.1                                                                                                                            |
| 5 (Tests + Docs)                                | Shipped M5-M7                                                                                                                           |
| 6 (Wizard Redesign)                             | Shipped M10                                                                                                                             |
| 7 (Foundation Repair)                           | Shipped M12-M13                                                                                                                         |
| 8 (Tech Debt Prevention)                        | Shipped M14-M16                                                                                                                         |
| 9 (Advanced Generation)                         | Shipped M17-M21                                                                                                                         |
| 10 (Production Baseline)                        | M22-M30 all shipped (M23/M24/M29 closed per MILESTONES.md §Reconciliation 2026-07-18; only the header checkmarks are missing)           |
| 11 (Ecosystem)                                  | M31-M33 all shipped (extended tools + plugin API v1 — see [`docs/PLUGIN-API.md`](../PLUGIN-API.md); closed per the same reconciliation) |

## Go/No-Go Rationale

**Go**, decided retroactively by the fact of shipping: the canonical-source thesis (ADR-001) held
across six stacks (TS, Java, Python, Go, Rust, Kotlin — `src/wizard/types.ts:92`) and eleven phases
without a rewrite, and the CLI-first / no-MCP boundary (ADR-020) held in the runtime — zero MCP
dependencies in `package.json` or `src/`. Two exceptions live in the governance arbiter generates:
INV-68 (MCP-first forensic inspection) and the opt-in `45-mcp-fallback.md` rule. Named reassessment
triggers, both drawn from consequences already recorded in their ADRs:

1. **ai-rulez ships its own `AGENTS.md` generation + edit-time hooks** — reopens the build-vs-adopt
   call in [ADR-010](../internal/ADR/010-ai-rulez-coexistence.md).
2. **Node-in-dev-environment becomes a real adoption blocker** for pure-Java/pure-Python shops — the
   negative consequence [ADR-006](../internal/ADR/006-typescript-node-cli.md) already accepted going
   in; a rising rate of that specific rejection reopens the runtime decision.

No other trigger is currently active; see [arc42.md §11.9](arc42.md#119-risk-register) for the live
risk register.
