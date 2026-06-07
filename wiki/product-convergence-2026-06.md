---
generated: true
source: 'docs/PRODUCT/CONVERGENCE-2026-06.md'
source_sha: '927aafc9f585d9fb8e8b68a2cbf5ef5a9b365524'
last_updated: '2026-06-07'
---

# Convergence Report — Batch C (2026-06)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/CONVERGENCE-2026-06.md](../docs/PRODUCT/CONVERGENCE-2026-06.md)

# Convergence Report — Batch C (2026-06)

**Date:** 2026-06-04  
**Audit type:** Batch C re-audit — fixed-point convergence verification  
**Auditor:** Claude Opus 4.8 (autonomous, 3 parallel Explore agents + direct gate runs)  
**Scope:** kotlin beta · resilience generator (#1176) · TUI/settings · FEATURE_MATRIX (INV-112/CANON-23)  
**Out of scope:** wave0.6 pipeline-drift (parked epic #1187) · v1 release

---

## Statement

**The doc/governance program has converged.**

Every FEATURE_MATRIX row is honestly statused. All parity gates pass. No new DELETE/DUP/DRIFT was
introduced by the four target waves. Every residual identified by this audit is now tracked as a
filed follow-up issue. The only remaining frontier is v1 / time-to-market.

---

## Gate Matrix

All gates run directly (exit codes captured). No "conceptual pass" claims.

| Gate                                   | Command                              | Result                                                                          |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| Invariant enforcement wired (CANON-09) | `check-inv-enforcement-wired.mjs`    | **OK** — 51 gate scripts wired, 2 hook citations verified                       |
| Catalog ↔ AGENTS.md parity (INV-51)    | `check-catalog-agents-parity.mjs`    | **OK** — 110 catalog IDs + 23 CANON refs, bidirectional                         |
| Global invariants parity               | `check-global-invariants-parity.mjs` | **OK** — 52 always-active documented, no phantom rows                           |
| CANON cross-references                 | `check-canon-references.mjs`         | **OK** — 23 CANON entries, all cross-refs valid                                 |
| Feature matrix (INV-112/CANON-23)      | `check-feature-matrix.mjs`           | **OK** — 51 rows, all KIT dims covered, L2                                      |
| arbiter doctor                         | `node dist/cli.js doctor`            | **9 passed, 0 failed, 1 benign WARN** (gate-pass log — expected on fresh clone) |
| Full quality gate                      | `node scripts/check-all.mjs check`   | **75 PASS, 1 SKIP (actionlint not installed locally), 0 FAIL**                  |

**Parity summary:** catalog INV **110 = 110** AGENTS.md · CANON **23 = 23**, all titles match ·
INV-83/84 gap is a deliberate RESERVED block (both files agree) · ADR digest **87 = 87 = 87**.

---

## FEATURE_MATRIX Honesty Audit

- **51 rows** (REQ-001..051), counter integrity verified (summary matches actual row count).
- Status breakdown: 2 Verified · 2 Done · 46 Partial · 1 Missing.
- **No faked Verified.** Both Verified rows have all 4 refs (`code_ref`, `test_ref`, `doc_ref`,
  `audit_trail`) existing on disk. REQ-041 (interactive wizard) self-discloses mocked-UI caveat —
  honest, not a violation.
- **Missing row** (REQ-033, kit experimental gate) candidly notes "gate is fiction — not enforced
  against real kit state." Honest and carries a follow-up issue.

---

## Named Residuals — Verdicts

| #   | Residual                                                                | Verdict                                                                                                                                       | Resolution                  |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | Kotlin Partial→full                                                     | TRACKED — beta cells honest (`cross-language-matrix.json` all `"maturity":"beta"`), no fixture by design                                      | #1177 (existing)            |
| 2   | N78 resilience kit-dim                                                  | UNTRACKED → filed                                                                                                                             | **#1191** (new)             |
| 3   | CLI-ref completeness (17 undocumented / gauntlet+ci+benchmark zero-doc) | CLAIM REFUTED — gauntlet (`website/reference/cli.md:630`), ci (`L566`), benchmark (`L548`) are documented; "17 undocumented" not reproducible | No issue — record corrected |
| 4   | Old `ci.yml` refs in example docs                                       | STALE — 3 example docs cite non-existent filename; generator emits numbered workflows                                                         | **#1188** (new)             |
| 5   | `semantic-review.yml.ejs` orphan                                        | CONFIRMED ORPHAN — only its render tests reference it; no generator emits it                                                                  | **#1190** (new)             |
| 6   | DECISIONS digest                                                        | RESOLVED — 87=87=87 ADRs, max ADR-087, generator current                                                                                      | No action                   |

---

## New DELETE / DUP / DRIFT from Target Waves

### What the waves introduced cleanly

- **INV-112/CANON-23 enforcement** — fully wired end-to-end (generator → template → gate → catalog → AGENTS.md). No drift.
- **Resilience generator (#1176)** — correctly registered, gated, tested, cataloged. No dead code, no copy-pasted helpers.
- **TUI/settings wave** — interactive commands wrap existing logic (no reimplementation). No DUP.
- **Kotlin beta (#1150)** — correctly held at Partial/beta with a real follow-up (#1177). No ghost cells.

### Residuals now tracked

| Finding                                                                                                                   | Severity | Issue         |
| ------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `knip.json` excludes type-exports → `check-no-unused-exports` hook enforces nothing on types; 60 unused types accumulate  | MEDIUM   | **#1189**     |
| FEATURE_MATRIX 40/46 Partial rows lack a tracked follow-up issue (gate-green, governance-weak)                            | MEDIUM   | **#1192**     |
| `semantic-review.yml.ejs` orphan template                                                                                 | LOW      | #1190 (above) |
| Trivia bundle (version-history "50 rows", gate copy-paste, warn-only canon gate, resilience REFERENCE-vs-GOVERNANCE path) | LOW      | **#1193**     |

### Items confirmed clean (no issue needed)

- No dead exported functions (knip values exit 0).
- No copy-pasted helpers in resilience/kotlin/TUI generators (DUP2 clean).
- SSOT indexes regenerated and current (docs/INDEX.md was stale by one doc entry; regenerated in this audit commit).
- MILESTONES.md wave-dir links properly annotated after `dda01e27` wave-hygiene commit.

---

## Residual Follow-Up Issue Summary

| Issue | Title                                                                                 | Status                    |
| ----- | ------------------------------------------------------------------------------------- | ------------------------- |
| #1177 | Kotlin support is placeholder — sonar/detekt/kover templates missing, smoke test only | Open (existing)           |
| #1187 | Epic: CI pipeline performance & drift fix (wave0.6)                                   | Parked post-v1 (existing) |
| #1188 | Stale `ci.yml` references in 3 example docs                                           | Open (new)                |
| #1189 | knip excludes type-exports — hook overstates coverage                                 | Open (new)                |
| #1190 | `semantic-review.yml.ejs` orphan template                                             | Open (new)                |
| #1191 | Resilience capabilit                                                                  |

_[content truncated — see source for full text]_

## See Also

- [[product-feature-comparison]] — related
- [[system-canon]] — related
