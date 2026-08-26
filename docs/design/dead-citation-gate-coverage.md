---
title: 'Dead-Citation Gate Coverage — docs/internal is excluded from a hard gate'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/check-doc-path-citations.mjs', 'docs/internal/architecture/ARCHITECTURE.md']
---

# Dead-Citation Gate Coverage — docs/internal is excluded from a hard gate

The dead-path-citation gate excludes the whole `docs/internal/` tree — including binding current-state documents.

## Problem statement

`scripts/check-doc-path-citations.mjs` is a HARD gate (`runCheck` since #2260) that fails when hand-authored prose cites a repo file path that does not exist. Its own CATALOG says the class "cannot regrow".

It can. `SKIP_PATH_SEGMENTS` (`:58-64`) excludes any path containing `/internal/`, with this rationale:

> decision/roadmap archives and the changelog legitimately narrate paths that were proposed, renamed, or removed — not current-state promises.

That rationale is sound for ADRs, DECISIONS.md and changelogs. But the segment is matched on the whole path, so it excludes **`docs/internal/` in its entirety**: 142 of the repo's 222 markdown docs. The gate reports "159 file(s) scanned" and passes green while the largest and most load-bearing part of the doc corpus is unexamined — CANON.md, FEATURE_MATRIX.md, the METHOD docs, the SYSTEM docs and the architecture tree included.

The gap is not hypothetical. `docs/internal/architecture/ARCHITECTURE.md:1147-1148` cites two paths under a directory that does not exist:

```
- `docs/audits/kit-canonical-mapping.json` — machine-readable 78-dim catalog
- `docs/audits/arbiter-skeleton-gap-analysis.md` — severity-rated gap matrix
```

`docs/audits/` is absent from the tree, and neither path is gitignored (so the `isGitIgnored` escape does not apply). The same document declares itself, at `:1099` and `:1146`, to be "**the binding** dual-track contract" — it is a current-state promise by its own words, precisely the category the exclusion claims not to cover.

Two dead citations found by inspection in the first internal document opened. The exclusion is hiding an unknown number more.

## Chosen approach

Narrow the exclusion from a path _segment_ to the document _kinds_ the rationale actually names, then triage whatever the widened scan surfaces.

The rationale distinguishes **archives** (ADRs, DECISIONS, changelog, roadmap — narrating paths that were proposed or removed) from **current-state documents** (architecture, CANON, METHOD, FEATURE_MATRIX — describing what is true now). The current segment list cannot express that distinction because `internal` is a location, not a kind.

Concretely: replace the `/internal/` segment with the specific archival subtrees (`docs/internal/ADR/`, and whichever of DECISIONS/changelog/roadmap the triage confirms), keeping `/changelog/`, `/design/`, `/audit/`, `/plans/` as they are. Then run the gate over the newly-covered 142 documents and triage the hits into the three buckets #2260 already established (runtime-written root, deliberate placeholder, gitignored-by-design) plus the per-file allowlist that already exists for deliberately historical prose.

Adoption follows the gate's own precedent: it shipped advisory in #2243 and was promoted to hard in #2260 once the corpus was triaged to zero. The widened scope should do the same — advisory until the new corpus is at zero, then hard.

## Key decisions and rejected alternatives

**D1 — Narrow the exclusion, do not delete it.**
The rationale is legitimate: an ADR that says "we removed `src/foo.ts`" must not fail a gate for citing a path that no longer exists. _Rejected_ removing `SKIP_PATH_SEGMENTS` wholesale — it would produce a large, mostly-false-positive corpus and would likely get reverted, leaving the gap permanent.

**D2 — Exclude by document kind, not by directory location.**
`internal` describes where a file lives, not what it promises. The mismatch between the stated rationale ("archives") and the implemented rule ("anything under /internal/") is the actual defect. _Rejected_ adding `docs/internal/architecture/` as a one-off inclusion: it would fix this instance and leave CANON.md, the METHOD docs and FEATURE_MATRIX equally unchecked.

**D3 — Fix the two known citations in the same PR, but they are not the point.**
`ARCHITECTURE.md:1147-1148` should be corrected (either the files are restored, or the citations are removed, or they move to the per-file allowlist with a reason). But a PR that only fixes those two lines leaves the gate still blind and the class still able to regrow. The coverage fix is the deliverable; the two lines are its first proof.

**D4 — Advisory before hard, following #2243→#2260.**
The gate's own history is the template: widen scope advisory, triage the corpus to zero, then promote. _Rejected_ widening straight to hard: it would turn the gate red on first run and pressure whoever lands it into blanket-allowlisting.

**D5 — The per-file allowlist is the escape hatch, and it is already the right shape.**
It is keyed by `${file}:${cited path}`, so an entry can never mask an unrelated future phantom in the same file. Genuinely historical prose inside a current-state document goes there, with a reason — not into a broadened segment skip.

## Open questions

- How many hits does the widened scan actually produce across the 142 documents? That number decides whether this is an afternoon or a campaign, and it should be measured before committing to the promotion step.
- Do `docs/internal/METHOD/` and `docs/internal/SYSTEM/` behave as current-state or as archive? `SYSTEM/GAP.md` is explicitly a point-in-time verification run ("run #2000"), which argues for per-subtree triage rather than one rule for all of `internal`.
- Should `check-doc-links.mjs` (link targets) and `check-phantom-command-scan.mjs` (command citations) be audited for the same over-broad exclusion? They are cited as siblings sharing the `SKIP_PATH_SEGMENTS` convention, so the defect may be shared.

---

## Acceptance Criteria

- [ ] AC-1: `SKIP_PATH_SEGMENTS` no longer excludes the whole `docs/internal/` tree; the exclusion is expressed in terms of the archival subtrees the rationale names, and the rationale comment is updated to match what the code does.
- [ ] AC-2: the gate's scanned-file count rises from 159 to cover the current-state internal documents, and the new count is asserted or reported.
- [ ] AC-3: the two dead citations at `docs/internal/architecture/ARCHITECTURE.md:1147-1148` are resolved — restored, removed, or allowlisted with a written reason.
- [ ] AC-4: the widened corpus is triaged to zero using the existing buckets (runtime-root, placeholder, gitignored) and the per-file allowlist; no new blanket segment skip is added.
- [ ] AC-5: a planted dead citation inside a current-state internal document (e.g. CANON.md) makes the gate fail — proving the coverage is real and not merely declared.
- [ ] AC-6: the widened scope ships advisory first if the triage is non-trivial, with the promotion to hard either done in the same PR (corpus at zero) or filed as a follow-up.
- [ ] AC-7: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No removal of `SKIP_PATH_SEGMENTS` or of the per-file allowlist mechanism.
- No auditing of `check-doc-links.mjs` or `check-phantom-command-scan.mjs` for the same defect (raised as an open question; separate issue if confirmed).
- No restoration of the `docs/audits/` directory as such — whether those files should exist is a separate question from whether the citation is honest.
- No change to the three triage buckets established by #2260.

## Files / contracts touched

- `scripts/check-doc-path-citations.mjs` — `SKIP_PATH_SEGMENTS`, rationale comment, allowlist entries
- `docs/internal/architecture/ARCHITECTURE.md` — the two dead citations (AC-3)
- Whatever the widened triage surfaces across `docs/internal/`
- `__tests__/scripts/` — the planted-citation proof (AC-5)
- Contract: the gate's exit-code contract and allowlist key format are unchanged

## Wave placement

Lane **F (docs & positioning)**, parallel with #2360 — disjoint file sets (`scripts/check-doc-path-citations.mjs` + `docs/internal/` vs `website/comparisons/`).
