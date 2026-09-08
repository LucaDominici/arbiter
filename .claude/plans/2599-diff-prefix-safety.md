---
title: '#2599 shared diff prefix safety'
doc_version: '1.0.0'
status: draft
last_review: '2026-09-08'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/agent', 'kind/plan']
related: ['#2599', '#2597']
files:
  - src/templates/claude/hooks/lib.mjs.ejs
  - .claude/hooks/lib.mjs
  - packages/kernel/hooks/lib.mjs
  - __tests__/hooks/empirical/hook-diff-scan.test.ts
  - __tests__/templates/hooks-lib-render.test.ts
  - __tests__/scripts/build-kernel-plugin.test.ts
  - .agents/plan/PLAN.json
  - .arbiter/evidence/tdd/#2599.json
  - .arbiter/evidence/ac-fit/2599.json
---
# #2599 shared diff prefix safety
Author Astra root; frozen base 2d23d37a631ecc4009650b28bec30a927a3ec5b8.
Standard shared security helper. Owner GO delegates native admission, not review waiver.
## Acceptance Criteria
- [ ] AC-1: The shared addedLinesVsHEAD helper retains added content beginning ++, including +++ with spaces or header-like text inside a hunk, while excluding real pre-hunk file headers. Correct new-file line numbering survives insertions, deletions, multiple hunks and no-newline markers.
- [ ] AC-2: Real tracked-file PostToolUse PII/placeholder/orphan-marker hook regressions detect newly added prefix-collision violations; ordinary violations still fail and untouched pre-existing fixture content remains ignored. No hook is skipped, disabled or weakened.
- [ ] AC-3: Fix the shared canonical helper and its shipped/template/kernel consumers through native generation, with parity/regeneration checks; no duplicate per-caller patch or threshold relaxation.
- [ ] AC-4: Preserve genuine RED before GREEN, obtain native plan/code/refutation approval and targeted regressions, then exact-head L1/L2, real CI and pr-ff/CAS landing. Rejoin #2597 and requalify its exact artifact/consumer after the prerequisite is fixed.

## Non-Goals
No new parser framework, dependency, scheduler, per-caller patch, gate relaxation,
or changes to #2578. #2597 remains a separate blocked train at review round2.
## Approach & decomposition
One TDD unit. Before any implementation, native independent plan approval and
Standard three-seat red-team. In addedLinesVsHEAD, ignore records before the first
hunk instead of ignoring every +++/--- prefix. Use an explicit inHunk boolean
set by a valid hunk header; retain the existing new-line counter and git fallback.
Apply to template and self twin; regenerate kernel via build-kernel-plugin.
Any additional generated snapshot/example files required by native parity must be
identified and admitted by bounded manifest amendment before generation, not hand-edited.
## Threat model & abuse cases
An added source line starting ++ is encoded as +++ and bypasses all shared callers.
PII, placeholder, orphan marker and skipped-test hooks consume this helper; preserving
whole-file fallback and real added-line detection is required. Synthetic fixture data only.
## Input validation
Trust git hunk headers, not raw +++ prefix. Retain git-error/untracked conservative fallback.
Deleted records and no-newline markers never advance the new-file line counter.
## Idiomatic patterns & pitfalls
Reuse existing git fixtures and renderTemplate; no new dependency or parser module.
Do not use a prefix matcher for headers inside a hunk. Keep later addition line numbers.
## Test strategy
Extend existing empirical parameterized hooks with prefix-collision regression (PII,
placeholder and orphan, plus skipped hook where applicable), ordinary positive and
untouched-existing negative controls remain. Add direct helper fixture for ++, +++,
header-like content, replacement/deletion, separated hunks and no trailing newline;
assert exact line numbers and contents. Test self and rendered helper.
Specifically add literal source `++ b/file.ts`, producing `+++ b/file.ts`
inside a hunk; assert that record survives while the identical real pre-hunk
header is excluded and does not increment the first added line number (RT-2599-B-01).
Commit genuine failing test before fix and record native RED with pinned commit.
Focused GREEN, formatting, template/render and kernel parity precede exact-head L1/L2.
## Merge contract
INV-08/23/24/25/26/27/53/138: native plan/red-team, real RED, independent security
code review and AC-fit, committed evidence, exact-head L1/L2 and green CI before
pr-ff/CAS landing. Rejoin #2597 afterward; its artifact/consumer require current binding.
No FEATURE_MATRIX row names #2599; infrastructure regression, no product row promotion.
## Risks
RT-2599-C-01 repair: admit the existing build-kernel-plugin test and add lib.mjs
to its byte-parity list. Run that test alone (no concurrent producer-reader gate).
Capture the unchanged generator's output and require kernel lib.mjs byte parity.
Before full L2, integrate the already committed #2597 builder-isolation repair
5bb7f8ed9927e4722c6e14e2e49532ceb9652958 through the native integration contract;
do not run the known shared-output collision again. Direct helper regressions
also exercise the retained kernel helper, not just self and rendered template.
Template/render drift and under-testing hunk counters: exercise real git output on
both twins, regenerate kernel and inspect native parity. Main advanced to08bd7d6b;
do not rewrite frozen base solely for unrelated main advance; final integration mandatory.
## Revision
Draft reviewed by author once: explicit inHunk state avoids overloading line0;
multiple-hunk and no-newline controls added before independent review.
