---
title: 'Arbiter — Current-State Analysis'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'ANALYSIS'
tags: ['audience/dev', 'kind/reference', 'kind/governance']
related: ['docs/architecture/arc42.md', 'docs/internal/PRODUCT/FEATURE_MATRIX.md', 'docs/architecture/feasibility.md']
---

# Arbiter — Current-State Analysis

A verified **as-is / state-of-fact** snapshot: what exists, what's confirmed working, what's
gap, as of this commit. Every count below was re-queried against **this worktree**, not
copied from a prior audit or task brief (see §Verification status — one number below already
moved between two audits four days apart, which is the point of pointing instead of copying).
Links-not-restatement throughout: this doc never re-derives what [`arc42.md`](arc42.md),
[`c4-model.md`](c4-model.md), or [`FEATURE_MATRIX.md`](../internal/PRODUCT/FEATURE_MATRIX.md)
already own.

## 1. Requirements inventory

| Corpus | Count (verified) | SSOT | Enforcement hook |
| --- | --- | --- | --- |
| REQ-NN (FEATURE_MATRIX rows) | 55: 4 Verified / 4 Done / 46 Partial / 1 Missing | `docs/internal/PRODUCT/FEATURE_MATRIX.md` (Summary table) | `scripts/check-feature-matrix.mjs --check` (L1) |
| — by GAMP verification tier | 13 SCAFFOLD / 22 GATE / 20 E2E | same file, Verification Tier Distribution table | same gate; tier cell format validated |
| INV-NN (invariants) | 137 | `src/invariants/catalog.ts` | STOP→REFUSE→cite INV-NN; catalog↔AGENTS.md parity (`scripts/check-catalog-agents-parity.mjs`) |
| CANON-NN (process rules) | 23 (CANON-01..23) | `docs/internal/SYSTEM/CANON.md` | STOP→REFUSE→cite CANON-NN protocol (`.claude/rules/30-canon-enforcement.md`) |
| ADR corpus | 113 files, gap at ADR-103 | `docs/internal/ADR/` (confirmed by `docs/internal/SYSTEM/DECISIONS.md`'s generated 113-row digest) | `scripts/check-adr-index.mjs` (INV-107) |
| KIT dimensions | 78 (N01–N78) | `src/kit/catalog.json` | FEATURE_MATRIX KIT Dimension Legend + Coverage tables |

`.claude/rules/30-canon-enforcement.md`'s table lists only 21 of the 23 CANON-NN rules — it is
explicitly a curated "most commonly triggered" quick-reference, not the catalog; not a gap.

## 2. Real surface

- **CLI**: `src/cli.ts` has 45 `.command(` registrations. Its own header comment
  (`src/cli.ts:427-434`) records a "14-command public surface"; 6 registrations carry
  `{ hidden: true }`, one of which (`help`) is deliberately excluded from the public-surface
  count (`src/cli.ts:2029-2030`), leaving 5 counted-experimental top-level commands — consistent
  with the 15-public/5-experimental split #2239's 2026-08-04 audit measured live via
  `arbiter help --all`. Enumerate the live surface with that command, not by hand-counting here.
- **Gate ladder**: `scripts/check-all.mjs:9-16` is the SSOT header, and says so explicitly —
  "hand-maintained... do not hand-copy an enumerated gate list here, it WILL drift." Current
  header: `check` (L1) = 114 hard + 1 advisory; `gate` (L1+L2 cumulative) = 139 hard + 7 advisory,
  as of #2043. This is already ahead of the 113/138 figure #2239's own body cites from its
  2026-08-04 audit — four days of drift on a number nobody hand-copied elsewhere, which is the
  gate's own anti-drift design working as intended.
- **Generators / templates**: `.bloat-baseline.json` (captured 2026-08-04, task #2041; regenerate
  via `scripts/capture-debt-baseline.mjs`) — generators 89 files/9979 LOC, commands 49/14541 LOC,
  templates 602/56163 LOC. `c4-model.md`'s hand-copied "85 files" / "554 .ejs files" are already
  flagged stale by #2239 item 3 (whose own cited baseline, dated 2026-08-03, is itself one
  snapshot behind the 2026-08-04 baseline read for this doc — same lesson twice).

## 3. Doc-role map

| Role | Doc | One line |
| --- | --- | --- |
| Design | [`arc42.md`](arc42.md) + [`c4-model.md`](c4-model.md) | Structural decomposition (arc42 §4/§5/§9) and its C4 visualization; owns *how it's built*. |
| Realization | [`FEATURE_MATRIX.md`](../internal/PRODUCT/FEATURE_MATRIX.md) | Gate-enforced RTM — requirement→code→test, the only realization/traceability doc that exists today. |
| Feasibility | [`feasibility.md`](feasibility.md) | Retroactive TELOS-lite justification record — *why it was built this way*. |
| Analysis | This doc | Verified as-is snapshot — *what's confirmed true right now*, links-not-restatement. |

The lean-docs spec that seeded this workstream also scopes a dedicated
`docs/architecture/realization.md` (a divergence log, distinct from the RTM) — not yet created;
tracked as #2251 below, not silently assumed done.

## 4. Known drift & gaps

| Gap | Scope | Tracked by |
| --- | --- | --- |
| Residual arc42/c4/CANON drift (phantom `fix-on-red.ts`, stale gate/generator/command/invariant counts, wrong paths) | `arc42.md`, `c4-model.md`, `docs/internal/SYSTEM/CANON.md` | #2239 (open) |
| RTM true-gaps, core governance/enforcement rows, `E2E` tier, no cited `test_ref` | 17 rows | #2244 (open) |
| RTM true-gaps, stack-support rows lack dedicated real-project fixture | 5 rows | #2245 (open) |
| RTM true-gaps, arbiter-internal meta-capability rows lack cited `test_ref` | 10 rows | #2246 (open) |
| RTM true-gaps, artifact/template-only scaffold rows, low enforcement risk | 8 rows | #2247 (open) |
| Scan blind spots — bare-word commands, dead file-path citations, count drift | post-wave-3 doc scan | #2243 (open) |
| Progressive escalation ladder (strikes 2→3→5) — declarative-only residue of #2043 | e2e gate consumption | #2248 (open) |
| **The 20 E2E-tier RTM rows with zero test evidence** (the FIT review's key finding) | fully accounted: 17 via #2244 + REQ-002/031 via #1156 + REQ-033 via #1151 | see above, no new issue needed |
| `docs/architecture/realization.md` (divergence log) speced but not created | lean-docs-spec §3 | #2251 (new, filed during this verification) |
| `adr-index.md:15` and `architecture/README.md:29` both hand-state "106 Architecture Decision Records" | verified actual = 113 files (gap at ADR-103); not in #2239's files-touched scope (arc42/c4/CANON only) | #2250 (new, filed during this verification) |

## 5. Verification status

**Protocol**: every count in §1–§2 was re-derived directly against this worktree
(`task/#2249-analysis-doc` @ wave-3 c294d29d + local commits, 2026-08-09) by grep/wc against the
cited SSOT file — not copied from #2239's 2026-08-04 audit, the originating task brief, or any
prior conversation. Two of the numbers above (gate-ladder, ADR corpus) already diverged from
their most recent prior audit within days, which is the argument *for* pointer-only sections, not
a defect in this doc.

**Method blend** (Step 0 research: as-is/current-state analysis practice, technical
due-diligence-lite audits, and gap-analysis templates all converge on the same three moves —
inventory grounded in re-checked facts, a current-state assessment separate from the gap list,
and a gap register with an owner per gap, never severity theater for a solo-repo audience):
inventory (§1) mirrors a due-diligence "audit the current state" pass; §2 is the facts-grounded
assessment (not perception); §4 is the gap register, each row already carrying its issue as
owner — the practitioner convention this repo already follows via `issue_ref`.

**Declared UNVERIFIABLE**: the 15-public/5-experimental CLI split is corroborated by static
reading of `src/cli.ts` but not independently re-run live via `arbiter help --all` in this pass;
treat #2239's 2026-08-04 live measurement as the operative source until re-run. Gate-ladder and
`.bloat-baseline.json` figures are point-in-time by construction — read them from their SSOT at
whatever moment matters, never from this table.

**Sources** (Step 0, informing the section shape only — no content restated from them):
[Lucidchart — as-is process analysis](https://lucid.co/blog/as-is-process-analysis),
[madewithlove — technical due diligence audits](https://madewithlove.com/services/audits/),
[Forbes Advisor — gap analysis four-step template](https://www.forbes.com/advisor/business/gap-analysis-template/).
