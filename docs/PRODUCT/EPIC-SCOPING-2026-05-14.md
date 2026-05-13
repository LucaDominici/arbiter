# Epic Scoping — 2026-05-14 (Wave 4)

Meta-epic scope lock-in for three pre-v1.0 governance containers. These epics do NOT ship code in this batch — they define the contract, cut list, child task seeds, and gate criteria for downstream execution.

Reference: project memory `[[project_milestone_roadmap]]` (M1–M21 done; M22–M32 planned; M33+ scoped here), `[[project_release_v1]]` (Release v1 = 76 issues #505–#580; this batch is META), `[[feedback_milestone_governance]]` (TDD + plan-review gate, no advance without scope).

The full scope-lock comments live on the issues themselves:

- #390 — https://github.com/LucaDominici/arbiter/issues/390#issuecomment-4445835896
- #391 — https://github.com/LucaDominici/arbiter/issues/391#issuecomment-4445835969
- #399 — https://github.com/LucaDominici/arbiter/issues/399#issuecomment-4445836034

This document is a one-page index over those three lock-ins.

## #390 — M33: Codebase Snapshot & External Audit Pack

| Field               | Value                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**            | Deterministic, governance-aware project snapshots (tree-sitter signatures + INV/gate/matrix/fixture metadata) for external advisor pipelines and pre-refactor audits. |
| **Priority / Size** | P2 / XL                                                                                                                                                               |
| **Status**          | Scoped, open                                                                                                                                                          |
| **In**              | 5 proven stacks, signature-only mode, governance header, semantic `snapshot diff`, daily self-cron, pre-PR freshness gate (L2 HARD).                                  |
| **Out (cut)**       | Beta-cell support, streaming/web-served snapshots, LLM summarization, encryption/signing, automated cross-project drift.                                              |
| **Children seeded** | M33.A vendor + extractors · M33.B CLI + tokenizer · M33.C metadata header · M33.D `diff` · M33.E daily cron + freshness gate.                                         |
| **Done when**       | All 5 stacks pass matrix integration test, self-cron live ≥14d, freshness gate blocks 3 induced-stale PRs, USAGE + FORMAT docs shipped.                               |

## #391 — M34: Matrix & Fixture Health Telemetry

| Field               | Value                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Goal**            | Continuous validation of every `proven` matrix cell. Adds CANON-02b (recency requirement) on top of CANON-02 (parity).                                                               |
| **Priority / Size** | P1 / XL                                                                                                                                                                              |
| **Status**          | Scoped, open                                                                                                                                                                         |
| **In**              | Matrix schema extension (zod), weekly GHA validation, promotion guard (≤7d pass), auto-issue + escalation, 90-day history, dashboard + badge.                                        |
| **Out (cut)**       | Beta-cell continuous validation, arm64/macOS runners, version pinning enforcement, SaaS dashboard, auto-fix of fixtures.                                                             |
| **Children seeded** | M34.A schema + zod · M34.B runner · M34.C GHA + bot + auto-issue · M34.D promotion guard + CANON-02b · M34.E dashboard + history + submission flow.                                  |
| **Done when**       | Promotion guard blocks 3 induced PRs, induced fixture failure opens P2 within 1 cycle (P1 after 3), arbiter self-matrix 100% ≤7d for ≥14 consecutive days, MATRIX-HEALTH.md shipped. |

## #399 — v1.0 GA scope lock-in

| Field                    | Value                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**                 | Lock the v1.0 contract: explicit IN/OUT, structural "cut-or-die" enforcement, ADR-documented decision. Avoid Viafera trajectory.                                                                                                                                          |
| **Priority / Size**      | (unlabeled) / XL                                                                                                                                                                                                                                                          |
| **Status**               | Scoped, open                                                                                                                                                                                                                                                              |
| **In**                   | Phase 9.5 (#81), audit F-fixes (F4/F11/F13/F14/F17), OSS-readiness (#392–#395), #398 Java decision, #396 Obsidian extract, #397 plugin @beta, CHANGELOG + RELEASE_NOTES, public flip, npm publish, GH release, cut-or-die rule encoded in templates + CONTRIBUTING + ADR. |
| **Out (cut / deferred)** | v1.1 roadmap planning, marketing/launch, haben2 integration, plugin API semver-stable, Obsidian/non-archetype generator features.                                                                                                                                         |
| **Children seeded**      | v1.0.A triage sweep · v1.0.B CHANGELOG/RELEASE_NOTES/ADR · v1.0.C templates + CONTRIBUTING for cut-or-die · v1.0.D public-flip + npm + tag · v1.0.E quarterly auto-triage workflow.                                                                                       |
| **Done when**            | Zero v1.0 IN open; OUT items labeled `v1.x-deferred`; repo public; `@arbiter/cli@1.0.0` on npm; cut-or-die rule blocks test feat-PR missing `Cuts:` line; ADR-NNN merged.                                                                                                 |
| **Target**               | T+45 working days from epic acceptance.                                                                                                                                                                                                                                   |

## Cut-or-die summary across the three

| Theme               | Held in v1.0                          | Deferred past v1.0                                    |
| ------------------- | ------------------------------------- | ----------------------------------------------------- |
| Snapshot/audit pack | —                                     | All of M33 (#390).                                    |
| Matrix telemetry    | INV-32 (existence), CANON-02 (parity) | M34 continuous validation + CANON-02b recency.        |
| Plugin API          | @beta marker only (#397)              | Semver-stable promise until ≥1 external plugin.       |
| Obsidian generator  | —                                     | Extracted to `@arbiter/plugin-obsidian-vault` (#396). |
| Real-project matrix | Java only (or demoted per #398)       | Cross-stack expansion (M34).                          |
| Testing discipline  | Current shipped subset (M22–M26)      | Phase 11/12/13.                                       |

## Status

All three issues remain OPEN as scoping containers. Child tasks will land via separate PRs, each citing the parent epic. This document and the on-issue comments are the durable record of the scope lock-in decision.
