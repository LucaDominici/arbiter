---
title: '#2535 product-acceptance skill admission'
doc_version: '1.0.0'
status: active
last_review: '2026-09-08'
owner: 'Luca Dominici'
canonical_id: 'task-2535-product-acceptance'
tags: ['audience/agent', 'kind/plan']
related: ['#2535']
---

context:
  issue: '#2535'
  type: docs
  pipeline: 'preflight → plan → RED evidence → source merge → focused GREEN → review → qualification'
  branch_convention: 'task/#2535-product-acceptance'
  base_branch: 'f8c0a65ef71e7bc2adb9e5dcbab71fedb215eb09'
  key_constraints:
    - 'Preserve the original three-commit source ancestry ending at 5538b118da074bd5a00ae7440bb41002db1d59fb.'
    - 'Keep the implementation limited to the one new .claude skill; do not add a parser, CLI behavior, template twin, or unrelated fix.'
    - 'The fenced FIELDLIST is typed field notation, not literal JSON; no JSON parser defect or speculative repair is in scope.'
    - 'Use a real f8-baseline RED test and native receipt; do not claim a docs-only TDD exemption because check-tdd-evidence classifies .claude/skills/** as non-documents.'
  red_team_warnings:
    - 'The regression must prove the new canonical skill is discoverable, names live delegated skills, and retains the session-output honesty boundary; it must not parse the FIELDLIST as JSON.'
    - 'Describe this as a regression retrofit against f8, not as original-author test-first history.'
  estimate: 'One existing-skill addition plus one focused regression and native TDD receipt.'

# #2535 product-acceptance skill admission

## Context and provenance

This is the existing source chain `2c038e33` → `ee8b7d7c` →
`5538b118da074bd5a00ae7440bb41002db1d59fb`, merged unchanged into a worktree
based on the qualified batch head `f8c0a65ef71e7bc2adb9e5dcbab71fedb215eb09`.
Its net product diff is exactly one new skill,
`.claude/skills/product-acceptance/SKILL.md` (299 lines), plus the focused
regression and native TDD receipt introduced after the initial admission check.
The owner granted the procedural waiver for this already-open PR; that waiver
is not a plan review, gate PASS, or acceptance claim.

## Scope

The exact seven-path administrative, product, test, and evidence write set is the
`scope.paths` array in `.agents/plan/PLAN.json`. The skill is an internal
planner/debriefer for chartered product-acceptance sessions. It delegates
promise checking, verification, refutation, and visual inspection to existing
skills; it does not add a runtime command, parser, workflow, dependency, or
emitted template. The typed FIELDLIST fence in the session-sheet section is a
documentation field list, not JSON input.

## Acceptance Criteria

- [ ] AC-2535.1: Adds `.claude/skills/product-acceptance/SKILL.md`: the planner and debriefer for testing a product as a finished thing, rather than reading its code.
- [ ] AC-2535.2: It explicitly delegates the walks to the existing `tabletop`, `verification`, `refutation`, and `visual-verification` skills instead of duplicating them.
- [ ] AC-2535.3: It provides session-based-test-management charter, session, session-sheet, and debrief guidance, including the effort split, charter-versus-opportunity, obstacles/outlook, and exact-build release-readiness rule.

## Non-goals

- No JSON parser, schema, CLI, command, gate, template twin, workflow, dependency, or product-runtime change.
- No synthetic JSON error, fabricated RED output, `ARBITER-SKIP-TDD` trailer, or evidence copied from another task.
- No full L1/L2, push, PR mutation, or main tracking-ref update until the current #2608 integration is on main or the owner explicitly directs otherwise.

## Approach and merge contract

The merge retains the original source as an ancestry parent and makes no content
change to the skill. `INV-55` requires Markdown references to resolve;
`INV-71` requires the documentation completion checklist; `INV-24`/`INV-25`
remain the L1/L2 gate contract; and `INV-26`/`INV-27` prohibit claiming an
unproduced TDD cycle. The reviewer checks the skill's delegation boundaries and
that no executable surface was added.

## Threat model, input validation, and pitfalls

There is no runtime input or security boundary: this file guides agents. Its
risk is process drift — a reader treating a session report as proof, replacing
the delegated walkers, or interpreting typed FIELDLIST prose as machine input.
The skill counters that risk by keeping verification/refutation separate from
finding and by requiring `NOT COVERED` for a missing prerequisite. Do not add a
parser merely because a fenced list resembles data.

## Test and verification strategy

Run `__tests__/skills/product-acceptance.test.ts`. It proves the canonical skill
path, native frontmatter, live `tabletop`/`verification`/`refutation`/
`visual-verification` references, and the result-matrix/findings/`NOT COVERED`
session-output boundary. It deliberately does not parse the FIELDLIST fence as
JSON. The test was first committed against actual f8 base as `0490a7c5` and
failed 2/2 because the canonical skill did not exist. Native `record-red` then
committed `.arbiter/evidence/tdd/#2535.json` as `5fd447de`; the preserved source
was real-merged and the same focused test passed 2/2. This is a regression
retrofit, not a claim about the original source author's test-first history.

Run frontmatter/style, Markdown links, emitted-Markdown references, skill
provenance, formatting, and native TDD verification in addition to the focused
test. `check-tdd-evidence` classifies `.claude/skills/**` as non-documents, so
the committed #2535 receipt is required rather than a docs-only exemption.

## Risks and current status

The GREEN regression and receipt are available for safe integration. Root's actual
review is retained in the portfolio evidence cited by the native plan-review and
AC-fit records; those two metadata paths are the only post-review scope extension.
Candidate status is source-integrated with focused GREEN evidence; L1/L2,
acceptance, and merge remain **NOT-TESTED**. No remote action is allowed until
#2608 is on main or the owner explicitly directs otherwise.
