# Arbiter — Feature Comparison Matrix

**Last updated:** 2026-04-02 (post-M11, resequenced per ADR-014)
**Updated after each milestone.**

---

## Legend

- **G** = Generates/installs this for target projects
- **P** = Has this as part of its own process (production-proven)
- **-** = Not present

## Comparison Table

| #   | Feature                                          | Arbiter                                                 | Viafera                                                                          | GSD 2                      | BMAD                      |
| --- | ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | ------------------------- |
|     | **GOVERNANCE & STANDARDS**                       |                                                         |                                                                                  |                            |                           |
| 1   | Canonical governance file (AGENTS.md)            | G                                                       | P                                                                                | -                          | -                         |
| 2   | Global invariants (typed, tiered, machine-cited) | G (10 INVs, 3 tiers)                                    | P (29 INVs, 5 tiers)                                                             | -                          | -                         |
| 3   | Authority hierarchy (doc precedence)             | G (3 levels)                                            | P (5 levels, fail-closed)                                                        | -                          | -                         |
| 4   | Governance levels (L1/L2/L3)                     | G                                                       | P (L1/L2/L3 + audit mode)                                                        | -                          | -                         |
| 5   | Process freeze / versioned governance            | -                                                       | P (v1.0 frozen)                                                                  | -                          | -                         |
| 6   | ENGINEERING_DEFAULTS (coding constitution)       | G (basic coding standards)                              | P (full SOLID, complexity limits, domain model conventions, null safety, naming) | -                          | -                         |
| 7   | TESTING_POLICY (test governance)                 | G (basic: 80% coverage)                                 | P (TDD mandatory, Testcontainers, no H2, no mocks in E2E, coverage tiers)        | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **WORKFLOW & TASK LIFECYCLE**                    |                                                         |                                                                                  |                            |                           |
| 8   | /start-task (task initialization)                | G (stack-parameterized, plan gate, tier classification) | P (30KB, tiered: XS/S/Standard, memory retrieval, SSOT routing, plan gate)       | P (spec injection)         | P (workflow-init)         |
| 9   | /complete-task (finalization)                    | G (stack-parameterized, gate + commit + PR)             | P (35KB, 5-phase: review + gate + commit + PR + merge + evidence)                | P (auto-advance)           | -                         |
| 10  | Task tier classification (XS/S/Standard)         | G (L2+ only)                                            | P (label-based, batch escalation)                                                | -                          | P (scale-domain-adaptive) |
| 11  | Plan gate (mandatory plan before edit)           | G (STOP-and-wait, L2+ only)                             | P (5-field plan contract, STOP-and-wait)                                         | P (spec phase)             | P (solutioning-gate)      |
| 12  | TDD protocol (/test-driven-development)          | G (reference in start-task, L2+)                        | P (6-step red-green-refactor with gates)                                         | -                          | -                         |
| 13  | Verification before completion                   | -                                                       | P (claim-based audit, correctness reasoning, evidence)                           | P (verify phase)           | -                         |
| 14  | Wave/sprint system (contract-based)              | -                                                       | P (Waves 0-5, entry/exit criteria)                                               | -                          | P (sprint planning)       |
| 15  | Batch execution rules (parallel tasks)           | -                                                       | P (disjoint areas only, track isolation)                                         | P (auto-loop)              | -                         |
| 16  | Session isolation (one task per chat)            | -                                                       | P (mandatory /clear between tasks)                                               | P (fresh context per task) | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **AGENT ARCHITECTURE**                           |                                                         |                                                                                  |                            |                           |
| 17  | Specialized sub-agents (agents/)                 | -                                                       | P (8 agents)                                                                     | P (phase agents)           | P (9+ agents)             |
| 18  | Skills system (skills/)                          | -                                                       | P (23 skills)                                                                    | -                          | P (15+ workflows)         |
| 19  | Agent personas (role + communication style)      | -                                                       | -                                                                                | -                          | P (core feature)          |
| 20  | Multi-agent code review                          | -                                                       | P (3-5 agents)                                                                   | -                          | -                         |
| 21  | Plan reviewer (red-team before execution)        | -                                                       | P                                                                                | -                          | -                         |
| 22  | Context rot management (3-layer redundancy)      | -                                                       | P                                                                                | P (core feature)           | -                         |
| 23  | Epic decomposition (/epic-decompose)             | -                                                       | P                                                                                | P                          | P                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **HOOKS**                                        |                                                         |                                                                                  |                            |                           |
| 24  | PreToolUse: stop-dangerous                       | G                                                       | P                                                                                | -                          | -                         |
| 25  | PreToolUse: enforce-read-only                    | G                                                       | -                                                                                | -                          | -                         |
| 26  | PreToolUse: pre-edit-ssot-guard                  | G                                                       | P                                                                                | -                          | -                         |
| 27  | PreToolUse: pre-edit-plan-anchor                 | -                                                       | P                                                                                | -                          | -                         |
| 28  | PostToolUse: check-no-orphan-todo                | G                                                       | P                                                                                | -                          | -                         |
| 29  | PostToolUse: check-no-any (TS)                   | G                                                       | -                                                                                | -                          | -                         |
| 30  | PostToolUse: post-commit-check                   | G                                                       | P                                                                                | -                          | -                         |
| 31  | PostToolUse: post-edit-dispatch (multi-check)    | -                                                       | P                                                                                | -                          | -                         |
| 32  | PostToolUseFailure: debug-state-on-failure       | -                                                       | P                                                                                | -                          | -                         |
| 33  | PostToolUseFailure: docker-debug-on-failure      | -                                                       | P                                                                                | -                          | -                         |
| 34  | UserPromptSubmit: skill-forced-eval              | -                                                       | P                                                                                | -                          | -                         |
| 35  | PreCompact: pre-compact                          | -                                                       | P                                                                                | -                          | -                         |
| 36  | WorktreeCreate: worktree-setup                   | -                                                       | P                                                                                | -                          | -                         |
| 37  | Hook runner (lib.mjs)                            | G                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **QUALITY GATES**                                |                                                         |                                                                                  |                            |                           |
| 38  | Gate script (check-all / ci)                     | G (L1/L2)                                               | P (L1/L2/L3, 60+ checks)                                                         | -                          | -                         |
| 39  | Audit mode toggle                                | -                                                       | P                                                                                | -                          | -                         |
| 40  | Gate dry-run                                     | -                                                       | P                                                                                | -                          | -                         |
| 41  | Codebase audit (9 domains)                       | -                                                       | P                                                                                | -                          | -                         |
| 42  | E2E escalation (count-based)                     | -                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **SSOT & DOCUMENTATION**                         |                                                         |                                                                                  |                            |                           |
| 43  | Knowledge map (routing table)                    | -                                                       | P                                                                                | P                          | -                         |
| 44  | SSOT core set (document inventory)               | -                                                       | P                                                                                | -                          | -                         |
| 45  | SSOT atomic contract (code + docs)               | -                                                       | P                                                                                | -                          | P                         |
| 46  | Track router (context economy)                   | -                                                       | P                                                                                | -                          | -                         |
| 47  | ADR system                                       | G                                                       | P (80+ ADRs)                                                                     | -                          | -                         |
| 48  | Documentation enforcement                        | G (L2+)                                                 | P                                                                                | -                          | -                         |
| 49  | Canonical paths                                  | -                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **GITHUB INTEGRATION**                           |                                                         |                                                                                  |                            |                           |
| 50  | CI workflow generation                           | G                                                       | P                                                                                | -                          | -                         |
| 51  | PR template                                      | G                                                       | P                                                                                | -                          | -                         |
| 52  | Issue template                                   | G (basic)                                               | P (7-section task-brief)                                                         | -                          | -                         |
| 53  | Labels (standard set)                            | G                                                       | P                                                                                | -                          | -                         |
| 54  | Branch protection                                | G                                                       | P                                                                                | -                          | -                         |
| 55  | CODEOWNERS                                       | G                                                       | P                                                                                | -                          | -                         |
| 56  | Dependabot                                       | G                                                       | P                                                                                | -                          | -                         |
| 57  | GitHub Project board                             | -                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **MULTI-TOOL SUPPORT**                           |                                                         |                                                                                  |                            |                           |
| 58  | Claude Code                                      | G                                                       | P                                                                                | -                          | -                         |
| 59  | Codex                                            | G                                                       | -                                                                                | -                          | -                         |
| 60  | Cursor                                           | G                                                       | -                                                                                | -                          | -                         |
| 61  | Copilot                                          | G                                                       | -                                                                                | -                          | -                         |
| 62  | ai-rulez coexistence                             | G                                                       | -                                                                                | -                          | -                         |
| 63  | Gemini CLI                                       | - (planned)                                             | -                                                                                | P                          | -                         |
| 64  | Multi-runtime                                    | -                                                       | -                                                                                | P                          | P                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **LANGUAGE DETECTION**                           |                                                         |                                                                                  |                            |                           |
| 65  | Language detection (5 languages)                 | G                                                       | -                                                                                | -                          | -                         |
| 66  | Framework detection                              | G                                                       | -                                                                                | -                          | -                         |
| 67  | Build tool detection                             | G                                                       | -                                                                                | -                          | -                         |
| 68  | Language-specific hooks                          | G                                                       | -                                                                                | -                          | -                         |
| 69  | Polyglot AGENTS.md                               | G                                                       | -                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **PROJECT BOOTSTRAP**                            |                                                         |                                                                                  |                            |                           |
| 70  | Interactive wizard (greenfield/brownfield)       | G                                                       | P                                                                                | -                          | P                         |
| 71  | Brownfield detection & migration                 | G                                                       | -                                                                                | -                          | -                         |
| 72  | Idempotent update                                | G                                                       | -                                                                                | -                          | -                         |
| 73  | Diff preview                                     | G                                                       | -                                                                                | -                          | -                         |
| 74  | Adoption tiers (Level 1/2/3)                     | -                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **MCP INTEGRATION**                              |                                                         |                                                                                  |                            |                           |
| 75  | Custom MCP servers                               | -                                                       | P                                                                                | -                          | -                         |
| 76  | MCP usage policy                                 | -                                                       | P                                                                                | -                          | -                         |
| 77  | MCP hard gate                                    | -                                                       | P                                                                                | -                          | -                         |
| 78  | Memory system integration                        | -                                                       | P                                                                                | -                          | -                         |
|     |                                                  |                                                         |                                                                                  |                            |                           |
|     | **DEVELOPER EXPERIENCE**                         |                                                         |                                                                                  |                            |                           |
| 79  | Web UI                                           | -                                                       | -                                                                                | P                          | -                         |
| 80  | Cost/token tracking                              | -                                                       | -                                                                                | P                          | -                         |
| 81  | Stuck loop detection                             | -                                                       | -                                                                                | P                          | -                         |
| 82  | Crash recovery                                   | -                                                       | -                                                                                | P                          | -                         |
| 83  | Auto-advance (autonomous)                        | -                                                       | -                                                                                | P                          | -                         |
| 84  | Worktree workflow                                | -                                                       | P                                                                                | -                          | -                         |
| 85  | Bug analysis pipeline                            | -                                                       | P                                                                                | -                          | -                         |

---

## Score Summary

| System      | Features with G or P | Coverage |
| ----------- | -------------------- | -------- |
| **Arbiter** | 37/85 (all G)        | 44%      |
| **Viafera** | 56/85 (all P)        | 66%      |
| **GSD 2**   | 14/85                | 16%      |
| **BMAD**    | 12/85                | 14%      |

**Note:** GSD 2 and BMAD excel in areas not in this matrix (autonomous execution, agent personas, web UI). This table focuses on governance features relevant to Arbiter's roadmap.

---

## Milestone Tracker

| Milestone                              | Issue   | Status   | Features Added                            |
| -------------------------------------- | ------- | -------- | ----------------------------------------- |
| M1-M10                                 | #10-#19 | Done     | 32 features (G)                           |
| M11: Workflow Commands                 | #34     | **Done** | +5 (rows 8-12)                            |
| M12: Go/Python Stack Parity            | #44     | Planned  | Fix: rows 6-7 for Go/Python (quality)     |
| M13: Doc Alignment + Retroactive Fixes | #45     | Planned  | Fix: documentation accuracy (no new rows) |
| M14: Arbiter Self-Enforcement          | #46     | Planned  | Infra: dog-food enforcement (no new rows) |
| M15: Generated Tech Debt Gates         | #47     | Planned  | +N rows TBD (coverage, complexity, etc.)  |
| M16: Novel Anti-Debt Mechanism         | #43     | Planned  | +N rows TBD (debt detection system)       |
| M17: Advanced Hooks                    | #35     | Planned  | +6 (rows 27, 31-36)                       |
| M18: Rich Invariant Catalog            | #37     | Planned  | +2 (rows 2, 10)                           |
| M19: Skills & Sub-Agents               | #36     | Planned  | +3 (rows 17-18, 21)                       |
| M20: SSOT Framework                    | #38     | Planned  | +5 (rows 43-46, 49)                       |
| M21: Richer GitHub Integration         | #39     | Planned  | +2 (rows 52, 57)                          |

**Target after M21:** 60+ /85 features (71%+) -- closing the gap with Viafera.
**M12-M16 focus:** Foundation repair + tech debt prevention (quality over quantity).
