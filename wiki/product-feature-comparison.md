---
generated: true
source: 'docs/PRODUCT/FEATURE_COMPARISON.md'
source_sha: 'ec71616f5957488c2d7328f1bd292dc06fdb89e7'
last_updated: '2026-06-07'
---

# Arbiter — Feature Comparison Matrix

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/FEATURE_COMPARISON.md](../docs/PRODUCT/FEATURE_COMPARISON.md)

# Arbiter — Feature Comparison Matrix

> **Engineering reference.** Public version: [website/comparisons/](../../website/comparisons/index.md). Refresh cadence: review quarterly.

**Last updated:** 2026-04-02 (post-M11, resequenced per ADR-014)
**Updated after each milestone.**

---

## Legend

- **G** = Generates/installs this for target projects
- **P** = Has this as part of its own process (production-proven)
- **NG** = Explicit non-goal (see linked ADR)
- **-** = Not present

## Comparison Table

| #   | Feature                                          | Arbiter                                                  | Prior-Art Baseline                                                               | GSD 2                      | BMAD                      |
| --- | ------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | ------------------------- |
|     | **GOVERNANCE & STANDARDS**                       |                                                          |                                                                                  |                            |                           |
| 1   | Canonical governance file (AGENTS.md)            | G                                                        | P                                                                                | -                          | -                         |
| 2   | Global invariants (typed, tiered, machine-cited) | G (10 INVs, 3 tiers)                                     | P (29 INVs, 5 tiers)                                                             | -                          | -                         |
| 3   | Authority hierarchy (doc precedence)             | G (3 levels)                                             | P (5 levels, fail-closed)                                                        | -                          | -                         |
| 4   | Governance levels (L1/L2/L3)                     | G                                                        | P (L1/L2/L3 + audit mode)                                                        | -                          | -                         |
| 5   | Process freeze / versioned governance            | -                                                        | P (v1.0 frozen)                                                                  | -                          | -                         |
| 6   | ENGINEERING_DEFAULTS (coding constitution)       | G (basic coding standards)                               | P (full SOLID, complexity limits, domain model conventions, null safety, naming) | -                          | -                         |
| 7   | TESTING_POLICY (test governance)                 | G (basic: 80% coverage)                                  | P (TDD mandatory, Testcontainers, no H2, no mocks in E2E, coverage tiers)        | -                          | -                         |
|     |                                                  |                                                          |                                                                                  |                            |                           |
|     | **WORKFLOW & TASK LIFECYCLE**                    |                                                          |                                                                                  |                            |                           |
| 8   | /task (full task lifecycle)                      | G (stack-parameterized, branch → plan → TDD → gate → PR) | P (tiered: XS/S/Standard, memory retrieval, SSOT routing, plan gate, evidence)   | P (spec injection)         | P (workflow-init)         |
| 10  | Task tier classification (XS/S/Standard)         | G (L2+ only)                                             | P (label-based, batch escalation)                                                | -                          | P (scale-domain-adaptive) |
| 11  | Plan gate (mandatory plan before edit)           | G (STOP-and-wait, L2+ only)                              | P (5-field plan contract, STOP-and-wait)                                         | P (spec phase)             | P (solutioning-gate)      |
| 12  | TDD protocol (/test-driven-development)          | G (reference in /task, L2+)                              | P (6-step red-green-refactor with gates)                                         | -                          | -                         |
| 13  | Verification before completion                   | -                                                        | P (claim-based audit, correctness reasoning, evidence)                           | P (verify phase)           | -                         |
| 14  | Wave/sprint system (contract-based)              | -                                                        | P (Waves 0-5, entry/exit criteria)                                               | -                          | P (sprint planning)       |
| 15  | Batch execution rules (parallel tasks)           | -                                                        | P (disjoint areas only, track isolation)                                         | P (auto-loop)              | -                         |
| 16  | Session isolation (one task per chat)            | -                                                        | P (mandatory /clear between tasks)                                               | P (fresh context per task) | -                         |
|     |                                                  |                                                          |                                                                                  |                            |                           |
|     | **AGENT ARCHITECTURE**                           |                                                          |                                                                                  |                            |                           |
| 17  | Specialized sub-agents (agents/)                 | -                                                        | P (8 agents)                                                                     | P (phase agents)           | P (9+ agents)             |
| 18  | Skills system (skills/)                          | -                                                        | P (23 skills)                                                                    | -                          | P (15+ workflows)         |
| 19  | Agent personas (role + communication style)      | -                                                        | -                                                                                | -                          | P (core feature)          |
| 20  | Multi-agent code review                          | -                                                        | P (3-5 agents)                                                                   | -                          | -                         |
| 21  | Plan reviewer (red-team before execution)        | -                                                        | P                                                                                | -                          | -                         |
| 22  | Context rot management (3-layer redundancy)      | -                                                        | P                                                                                | P (core feature)           | -                         |
| 23  | Epic decomposition (/epic-decompose)             | -                                                        | P                                                                                | P                          | P                         |
|     |

_[content truncated — see source for full text]_
