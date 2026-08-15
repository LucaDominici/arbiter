---
title: '/gap'
doc_version: '1.0.0'
status: active
last_review: '2026-06-05'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: ['PRODUCT/GAP.md', 'PRODUCT/FEATURE_MATRIX.md']
---

# /gap

Regenerate and display `docs/internal/PRODUCT/GAP.md` — the derived view of what is
incomplete, unenforced, or parked in this project, ordered v1-blockers first.

## Steps

1. Run `node scripts/gen-gap.mjs --write` to regenerate `docs/internal/PRODUCT/GAP.md`.

2. Read `docs/internal/PRODUCT/GAP.md` and surface the key sections:
   - **v1 Blockers** — anything that must be resolved before v1.
   - **Feature Gaps** — incomplete capabilities.
   - **Enforcement Gaps** — unenforced constraints from constraint-scan.
   - **Known Debt** — parked issues from convergence reports and tech-debt.json files.

3. If the gap register is empty (all sections show "No … gaps."), report: "GAP register clean."

## Allowed Tools

- `Bash` to run `node scripts/gen-gap.mjs --write`
- `Read` for `docs/internal/PRODUCT/GAP.md`

## Related Commands

- **Feature matrix:** review `docs/internal/PRODUCT/FEATURE_MATRIX.md` to see capability status
- **Status:** `/status` for task phase and build health
