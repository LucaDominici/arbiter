---
title: 'Arbiter — Current-State Analysis'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'ANALYSIS'
tags: ['audience/dev', 'kind/reference', 'kind/governance']
related:
  [
    'docs/architecture/arc42.md',
    'docs/internal/PRODUCT/FEATURE_MATRIX.md',
    'docs/architecture/feasibility.md',
  ]
---

# Arbiter — Current-State Analysis

A verified **as-is / state-of-fact** snapshot: what exists, what's confirmed working, what's
gap, as of this commit. Every count below was re-queried against **this worktree**, not
copied from a prior audit or task brief (see §Verification status — the gate-ladder count below
moved by one verified commit between the last audit and this one, which is the point of pointing
instead of copying). Links-not-restatement throughout: this doc never re-derives what [`arc42.md`](arc42.md),
[`c4-model.md`](c4-model.md), or [`FEATURE_MATRIX.md`](../internal/PRODUCT/FEATURE_MATRIX.md)
already own.

## 1. Requirements inventory

| Corpus                       | Count (verified)                                 | SSOT                                                                                                                | Enforcement hook                                                                              |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| REQ-NN (FEATURE_MATRIX rows) | 55: 4 Verified / 4 Done / 46 Partial / 1 Missing | `docs/internal/PRODUCT/FEATURE_MATRIX.md` (Summary table)                                                           | `scripts/check-feature-matrix.mjs --check` (L1)                                               |
| — by GAMP verification tier  | 13 SCAFFOLD / 22 GATE / 20 E2E                   | same file, Verification Tier Distribution table                                                                     | same gate; tier cell format validated                                                         |
| INV-NN (invariants)          | 137 entries (INV-01..139, gaps at INV-83/84)     | `src/invariants/catalog.ts`                                                                                         | STOP→REFUSE→cite INV-NN; catalog↔AGENTS.md parity (`scripts/check-catalog-agents-parity.mjs`) |
| CANON-NN (process rules)     | 23 (CANON-01..23)                                | `docs/internal/SYSTEM/CANON.md`                                                                                     | STOP→REFUSE→cite CANON-NN protocol (`.claude/rules/30-canon-enforcement.md`)                  |
| ADR corpus                   | numbering contiguous, no gaps (see the dir)      | `docs/internal/ADR/` (count is pointer-only by policy; the digest `docs/internal/SYSTEM/DECISIONS.md` is generated) | `scripts/check-adr-index.mjs` (INV-107)                                                       |
| KIT dimensions               | 78 (N01–N78)                                     | `src/kit/catalog.json`                                                                                              | FEATURE_MATRIX KIT Dimension Legend + Coverage tables                                         |

`.claude/rules/30-canon-enforcement.md`'s table lists only 21 of the 23 CANON-NN rules — it is
explicitly a curated "most commonly triggered" quick-reference, not the catalog; not a gap.

## 2. Real surface

- **CLI**: `src/cli.ts` has 45 `.command(` registrations. Live-run this session (`npx tsx
src/cli.ts --help` / `help --all`, not hand-counted): **15 public top-level commands, 5
  experimental** (`doc-set`, `graph`, `mark`, `settings`, `upgrade-level`) — matches #2239's
  2026-08-04 figure. `src/cli.ts:427-428`'s own header comment says "14-command public surface"
  — stale by one against the live-verified 15; a source-comment instance of the same
  hand-copied-count class #2243 already scopes generically (its class-3 "numeric-count
  citations"), so no separate issue filed for one inline comment. Enumerate the live surface with
  `arbiter help --all`, not by hand-counting here or trusting the comment.
- **Gate ladder**: `scripts/check-all.mjs:9-16` is where the counts live, and warns about itself —
  "hand-maintained... do not hand-copy an enumerated gate list here, it WILL drift." Current
  header: `check` (L1) = 114 hard + 1 advisory; `gate` (L1+L2 cumulative) = 139 hard + 7 advisory,
  as of #2043 (commit `10cf4490`, 2026-08-08, confirmed an ancestor of this worktree's HEAD). That
  commit's own diff shows the prior state was 113/138 "as of #2042" — exactly the figure #2239's
  2026-08-04 audit cites — so the header moved once, verifiably, between that audit and this
  worktree's current HEAD. Read the live header at whatever moment matters; never hand-copy this
  number elsewhere.
- **Generators / templates**: `.bloat-baseline.json` (captured 2026-08-04, task #2041; regenerate
  via `scripts/capture-debt-baseline.mjs`) — generators 89 files/9979 LOC, commands 49/14541 LOC,
  templates 602/56163 LOC. c4-model.md is in #2239's files-touched scope but its 85/554 numbers are
  NOT an enumerated drift item (item 3 names arc42.md:166/:620-621 only); #2239's own cited baseline
  (2026-08-03) is one snapshot behind.

## 3. Doc-role map

| Role        | Doc                                                          | One line                                                                                             |
| ----------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Design      | [`arc42.md`](arc42.md) + [`c4-model.md`](c4-model.md)        | Structural decomposition (arc42 §4/§5/§9) and its C4 visualization; owns _how it's built_.           |
| RTM         | [`FEATURE_MATRIX.md`](../internal/PRODUCT/FEATURE_MATRIX.md) | Gate-enforced requirement→code→test traceability at fine grain.                                      |
| Realization | [`realization.md`](realization.md)                           | Thin pointer index (requirement-cluster → arc42 §5 block) + divergence log — never restates the RTM. |
| Feasibility | [`feasibility.md`](feasibility.md)                           | Retroactive TELOS-lite justification record — _why it was built this way_.                           |
| Analysis    | This doc                                                     | Verified as-is snapshot — _what's confirmed true right now_, links-not-restatement.                  |

Per #2251, `docs/architecture/realization.md` now exists — the row above supersedes the earlier
"realization = FEATURE_MATRIX.md" conflation this doc previously recorded as the state of fact.

## 4. Known drift & gaps

| Gap                                                                                                                                                                                                | Scope                                                                                           | Tracked by                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Residual arc42/c4/CANON drift (phantom `fix-on-red.ts`, stale gate/generator/command/invariant counts, wrong paths)                                                                                | `arc42.md`, `c4-model.md`, `docs/internal/SYSTEM/CANON.md`                                      | #2239 (open)                                |
| RTM true-gaps, core governance/enforcement rows, `E2E` tier, no cited `test_ref`                                                                                                                   | 17 rows                                                                                         | #2244 (open)                                |
| RTM true-gaps, stack-support rows lack dedicated real-project fixture                                                                                                                              | 5 rows                                                                                          | #2245 (open)                                |
| RTM true-gaps, arbiter-internal meta-capability rows lack cited `test_ref`                                                                                                                         | 10 rows                                                                                         | #2246 (open)                                |
| RTM true-gaps, artifact/template-only scaffold rows, low enforcement risk                                                                                                                          | 8 rows                                                                                          | #2247 (open)                                |
| Scan blind spots — bare-word commands, dead file-path citations, count drift                                                                                                                       | post-wave-3 doc scan                                                                            | #2243 (open)                                |
| Progressive escalation ladder (strikes 2→3→5) — declarative-only residue of #2043                                                                                                                  | e2e gate consumption                                                                            | #2248 (resolved wave-4)                     |
| **The 20 E2E-tier RTM rows with zero test evidence** (the FIT review's key finding)                                                                                                                | fully accounted: 17 via #2244 + REQ-002/031 via #1156 + REQ-033 via #1151                       | see above, no new issue needed              |
| `docs/architecture/realization.md` (divergence log) speced but not created                                                                                                                         | #2251                                                                                           | #2251 (new, filed during this verification) |
| `adr-index.md:15` and `architecture/README.md:29` both hand-state "106 Architecture Decision Records"                                                                                              | RESOLVED: converted to pointer form; the ADR-103 half of the finding closed separately by #2330 | #2250 (new, filed during this verification) |
| `PRD.md` Phase 10/11 marked "in progress" while MILESTONES.md §Reconciliation 2026-07-18 records every constituent milestone CLOSED; also a M22-M30 vs M22-M32 range mismatch between the two docs | `docs/PRODUCT/PRD.md`, `docs/internal/PRODUCT/MILESTONES.md`                                    | #2252 (new, filed during this verification) |

## 5. Verification status

**Protocol**: every count in §1–§2 was re-derived directly against this worktree
(`task/#2249-analysis-doc` @ wave-3 c294d29d + local commits, 2026-08-09) by grep/wc against the
cited SSOT file, or by live-running the CLI, not copied from #2239's 2026-08-04 audit, the
originating task brief, or any prior conversation. The gate-ladder count moved by one verified
commit (`10cf4490`) since that audit, and the ADR corpus diverged from adr-index.md's hand-typed
106 — both are the argument _for_ pointer-only sections, not a defect in this doc.

**Method blend** (Step 0 research: as-is/current-state analysis practice, technical
due-diligence-lite audits, and gap-analysis templates all converge on the same three moves —
inventory grounded in re-checked facts, a current-state assessment separate from the gap list,
and a gap register with an owner per gap, never severity theater for a solo-repo audience):
inventory (§1) mirrors a due-diligence "audit the current state" pass; §2 is the facts-grounded
assessment (not perception); §4 is the gap register, each row already carrying its issue as
owner — the practitioner convention this repo already follows via `issue_ref`.

**Evidence-verifier audit (2026-08-09)**: an independent evidence-verifier pass fact-checked 69
claims across this doc, feasibility.md, and FEATURE_MATRIX.md's new sections: 52 TRUE, 7 FALSE,
2 STALE, 7 PARTLY_TRUE, 1 UNVERIFIABLE. Every correction the audit raised is already applied in
this revision.

**Declared UNVERIFIABLE**: one — §3 as first drafted cited a "lean-docs-spec §3" for
`docs/architecture/realization.md`'s scope, and no such spec document exists anywhere in this
repo; resolved by citing #2251 (the issue that durably records the claim) instead. Everything
else in §1–§2 held up after live-running the CLI to settle the public/experimental split.
Gate-ladder and `.bloat-baseline.json` figures are point-in-time by construction — read them from
their SSOT at whatever moment matters, never from this table. The GAMP tier split (13/22/20, §1)
is independently re-counted from the FEATURE_MATRIX table body this session (`grep -c` on the
tier column), not merely trusted from its own hand-maintained Distribution table.

**Sources** (Step 0, informing the section shape only — no content restated from them):
[Lucidchart — as-is process analysis](https://lucid.co/blog/as-is-process-analysis),
[madewithlove — technical due diligence audits](https://madewithlove.com/services/audits/),
[Forbes Advisor — gap analysis four-step template](https://www.forbes.com/advisor/business/gap-analysis-template/).
