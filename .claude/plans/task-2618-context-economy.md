---
context:
  issue: '#2618'
  type: perf
  pipeline: 'plan → independent review → red → green → verification → PR'
  branch_convention: 'task/#2618-context-economy'
  base_branch: 'main @ 80b5c544f9ef1e4fabf3202407786e24bc553e2b'
  key_constraints:
    - 'Keep all governance and actual generator-replacement/do-not-overwrite rules available and authoritative.'
    - 'Reuse the existing skills matrix, skip report and init-time detected-integrations snapshot; add no inventory or configuration authority.'
    - 'Do not modify any consumer while measuring the candidate output.'
    - 'Report bytes separately from model-token or delivery-speed claims.'
  red_team_warnings:
    - 'Update re-detects skills but does not refresh detected-integrations.json; never describe that init snapshot as current after update.'
    - 'Filtering only on frontmatter role would hide matrix-known operative skills.'
    - 'Filtering before replacement qualification must not weaken version-gated generator substitution.'
  estimate: 'S (bounded generator filter, tests and one read-only consumer proof)'
files:
  - src/generators/agents-md.ts
  - src/templates/agents-md/AGENTS.md.ejs
  - __tests__/generators/agents-md.test.ts
  - docs/INTEGRATIONS.md
  - .agents/plan/PLAN.json
  - .claude/plans/task-2618-context-economy.md
  - .arbiter/evidence/tdd/#2618.json
  - .arbiter/evidence/benchmark/#2618.json
---

# #2618 — Bound always-loaded skill inventory

## Outcome

`AGENTS.md` contains only installed skills that affect agent behavior: a declared operative role or an actual built-in generator replacement. The complete detected inventory remains in the existing `.arbiter/detected-integrations.json` audit artifact.

## Current flow and root cause

`detectInstalledSkills` returns every discovered skill. Init persists a complete detection snapshot in `.arbiter/detected-integrations.json`; update re-detects skills but does not refresh that snapshot. Both flows compute replacement decisions and call `renderAgentsMd`, which currently passes the unfiltered set to the template, so unrelated inventory is copied into every worker's always-loaded governance context.

## Change

1. In `renderAgentsMd`, join installed skills with the existing skills matrix and `skippedGenerators`.
2. Keep a row when the skill has an explicit role, a matrix role, or at least one matching replacement. Prefer the explicit role, then the matrix role.
3. Pass only those enriched rows to the existing template. Do not change detection, the complete audit artifact, replacement/version qualification, or generator registry behavior.
4. Clarify the template text: the table is the operative subset. Describe `.arbiter/detected-integrations.json` only as an init-time snapshot when present; do not claim it is refreshed by update or link to it unconditionally.
5. Update the existing integrations reference with the same operative-view and init-snapshot semantics.

## Acceptance Criteria

- [ ] AC-1: Keep all governance and actual generator-replacement/do-not-overwrite rules available and authoritative.
- [ ] AC-2: Remove unrelated installed-skill inventory from always-loaded AGENTS.md. Prefer omitting rows with no operative role/replacement; disclose any necessary full inventory through an existing on-demand artifact if available, not a new framework.
- [ ] AC-3: Synthetic large-catalogue regression: adding 1,000 unrelated skills must not grow the always-loaded governance table; real replacement entries must remain actionable.
- [ ] AC-4: Preserve generated-file lifecycle, profile variations, link integrity and native gates; verify on one actual consumer before claiming context reduction in use.
- [ ] AC-5: Measure bytes before/after separately from model-token or delivery-speed claims. No measured speedup yet.

## Verification Strategy

- RED/GREEN seam: `renderAgentsMd`.
- Adding 1,000 unrelated skills produces byte-identical `AGENTS.md` output.
- A real replacement stays listed with its replaced generator.
- A matrix-known operative skill without a replacement stays listed with its matrix role.
- An unknown skill without role or replacement is omitted.
- Existing generator tests and template/render gates remain green.
- Existing init/update, brownfield and cross-profile matrix tests remain green so the filter is proven at every existing caller without changing lifecycle behavior.
- Read-only proof on `/home/luca/work/repos/coach-system`: compare its current 89,959-byte / 1,240-line `AGENTS.md` with candidate rendering from the same config and installed-skill environment. Report bytes separately from token or speed claims.
- Persist the paired base-versus-candidate result in the existing benchmark evidence store so the reduction is attributable to this renderer change rather than unrelated consumer drift.

## Non-Goals

- No new inventory, configuration key, evidence store, hook, loader, or telemetry. No consumer file is modified during measurement.
