---
title: '#2599 shared diff prefix safety'
doc_version: '1.0.0'
status: draft
last_review: '2026-09-08'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/agent', 'kind/plan']
related: ['#2599', '#2597']
context:
  issue: '#2599'
  type: fix
  pipeline: 'plan repair → independent review → generation → gate → PR'
  branch_convention: 'task/#2599-diff-prefix-safety'
  base_branch: main
  key_constraints:
    - 'Preserve real TDD, native review, exact-candidate gates and delivery postconditions.'
    - 'Historical wiki run changed only three admitted files. Integration refresh permits only the sixteen paths listed below; preserve each verified preimage and the original receipt. Scanner amendment admits only .gitleaks.toml.'
  red_team_warnings:
    - 'Receipt publication failure must restore the original vault; nonzero exit invalidates any apparent PASS.'
    - 'Cooperative ownership is not operating-system exclusion; interrupted runs require recovery.'
  estimate: 'S (2h remaining qualification estimate; integration conflicts may extend it)'
files:
  - .gitleaks.toml
  - src/templates/claude/hooks/lib.mjs.ejs
  - .claude/hooks/lib.mjs
  - packages/kernel/hooks/lib.mjs
  - __tests__/hooks/empirical/hook-diff-scan.test.ts
  - __tests__/templates/hooks-lib-render.test.ts
  - __tests__/scripts/build-kernel-plugin.test.ts
  - .agents/plan/PLAN.json
  - .arbiter/evidence/tdd/#2599.json
  - .arbiter/evidence/ac-fit/2599.json
  - docs/internal/SYSTEM/HOOK-CONTRACTS.md
  - examples/ts-library/.arbiter-generated-manifest.json
  - examples/ts-library/.claude/hooks/lib.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/python-library/.claude/hooks/lib.mjs
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/go-library/.claude/hooks/lib.mjs
  - wiki/internal-system-hook-contracts.md
  - wiki/INDEX.md
  - wiki/.wiki-log.json
  - wiki/deprecations.md
  - wiki/quickstart.md
  - wiki/reference-anti-fake-green.md
  - wiki/reference-backward-compat-harness.md
  - wiki/reference-ci-tier-workflows.md
  - wiki/reference-file-stability.md
  - wiki/reference-task-recovery.md
  - wiki/reference-workflow-pr-fast.md
  - wiki/semver.md
  - wiki/design-anti-context-rot-enforcers.md
  - wiki/internal-development-real-project-testing.md
  - wiki/internal-method-tabletop-scenarios.md
  - wiki/internal-system-decisions.md
  - .arbiter/evidence/wiki-preview/2599/preview.log
  - .arbiter/evidence/wiki-preview/2599/preview-complete.log
  - .arbiter/evidence/wiki-preview/2599/actual-run-20260909.json
---
# #2599 shared diff prefix safety
Author Astra root; frozen base 2d23d37a631ecc4009650b28bec30a927a3ec5b8.
Standard shared security helper. Owner GO delegates native admission, not review waiver.
## Acceptance Criteria
- [ ] AC-1: The shared addedLinesVsHEAD helper retains added content beginning ++, including +++ with spaces or header-like text inside a hunk, while excluding real pre-hunk file headers. Correct new-file line numbering survives insertions, deletions, multiple hunks and no-newline markers.
- [ ] AC-2: Real tracked-file PostToolUse PII/placeholder/orphan-marker hook regressions detect newly added prefix-collision violations; ordinary violations still fail and untouched pre-existing fixture content remains ignored. No hook is skipped, disabled or weakened.
- [ ] AC-3: Fix the shared canonical helper and its shipped/template/kernel consumers through native generation, with parity/regeneration checks; no duplicate per-caller patch or threshold relaxation.
- [ ] AC-4: Preserve genuine RED before GREEN, obtain native plan/code/refutation approval and passing targeted regressions before entering exact-head verification.

## Required delivery postconditions — issue remains open until all are proven
Exact-head L1/L2, real green CI and pr-ff/CAS landing remain mandatory, with no
waiver or substitution. Rejoin #2597 and requalify its exact artifact/consumer
after this prerequisite lands. Do not put `Closes #2599` in the prerequisite PR:
close this issue only after that post-merge evidence is green, under wave-drain's
iff-closure contract. An AC-fit PASS permits verification, not delivery acceptance.

## Non-Goals
- No new diff framework, dependencies, new scheduler or broader hook rewrite. Do not change #2578 scope or package-size thresholds. Do not treat full-file scanning at landing as a replacement for edit-time detection.
- Additionally, no per-caller patch or gate relaxation. #2597 remains a separate blocked train at review round2.
## Approach & decomposition
One TDD unit. Before any implementation, native independent plan approval and
Standard three-seat red-team. In addedLinesVsHEAD, ignore records before the first
hunk instead of ignoring every +++/--- prefix. Use an explicit inHunk boolean
set by a valid hunk header; retain the existing new-line counter and git fallback.
Apply to template and self twin; regenerate kernel via build-kernel-plugin.
Any additional generated snapshot/example files required by native parity must be
identified and admitted by bounded manifest amendment before generation, not hand-edited.
Bounded 2026-09-08 amendment: update the existing hook contract's diff-scanning
section and regenerate the three living examples with `npm run examples:regenerate`.
The only admitted derived changes are each example's hook lib and generated manifest.
Abort if any porcelain status (including ignored/untracked files) appears below
the three example roots. First run `npm run examples:regenerate -- --check` and
retain its exact changed/added/removed set; write only if that set is exactly the
six admitted outputs, otherwise amend scope before generation. This checks clean
committed content preservation as well as dirty/untracked content safety.
Correct only the parity comment in `__tests__/scripts/build-kernel-plugin.test.ts`
to include #2599; no test logic or `scripts/build-kernel-plugin.mjs` change.
Wiki follow-up: the native L1 on 97c3966ddf38c6d89d3deb1fa603a07765b7969b isolates only the generated Hook Contracts
page's stale source hash. Run `node scripts/gen-wiki.mjs --check`; then seed an
owned temporary copy from the verified complete preimage, including .wiki-log.json,
and compare every copied path/hash before previewing (never use an empty directory).
Run `--changed --wiki-dir <owned temporary copy>` and require only the admitted page,
INDEX and runtime log writes, with zero pruned pages. Preserve the original wiki
bytes and stop on any additional changed/removed path. Run the same native
`--changed` against this worktree after approval, then check-wiki-lint and --check.
Wiki outputs remain gitignored as the native contract intends: commit plan/evidence,
not the ignored generated vault. This wiki-only amendment makes no ADDITIONAL
generator, source document, AC or gate change: the earlier committed
HOOK-CONTRACTS.md edit remains admitted in the cumulative train manifest.
The two native preview logs already committed under `.arbiter/evidence/wiki-preview/2599/`
are explicitly part of this evidence scope; their original bytes and timestamps stay
unchanged. `modify` denotes the existing wiki files, not a promise to track them.
All manifest operations describe the cumulative train against frozen base
`2d23d37a631ecc4009650b28bec30a927a3ec5b8`, not a request to recreate already
committed evidence at current HEAD. Preserve the preimage archive
`/home/luca/work/forma-rooms/portfolio/evidence/arbiter-2599/cycle-1788868307/wiki-before.tar`
with SHA-256 `90508b5e1520c87ec5d0bfc47045d856c8c9a937bb0b74398102599cc2138172`.
The generator is not transactional: unexpected changes/removals or nonzero prune
count are detected after execution. Restore affected original files from that
verified preimage and stop continuation on any such result; do not call this a
stop-before-write guarantee. New unexpected files stay preserved for diagnosis.
Owner re-admission on 2026-09-09 01:14 CEST, recorded in issue comment5593165614,
authorizes PLAN REPAIR ONLY. Original FAIL reviews and three new HIGH claims stay
preserved; three independent skeptics upheld each claim in cycle1788909567.
Fresh owner delegation on 2026-09-09 is recorded in issue comment5598973787:
ordinary GitHub decisions and completion are authorized after plan repair. This
supersedes the owner stop, not any independent technical finding or native gate.

Concrete bounded writer reservation: the interactive root owns supervisor.lock; the
service is inactive and its last attempt terminated on provider quota. Root reserves this
exact worktree exclusively to Astra by Luca's owner assignment and the SAME
delivery register until explicit terminal release. Native `arbiter mark` records
that decision in the task cursor; it neither grants nor enforces a reservation.
This is the owner-enforced
single-writer contract (AGENTS worktree isolation and rule50), NOT a claim that
agents-active.json is a lock or that gate-exec excludes arbitrary commands.
Before starting, verify the terminal prior handoff, native sidecars, /proc ancestry,
all child jobs and exact cwd; PID2438633 is dead, but that fact alone is insufficient.
The interactive root is this tree's sole writer. All review agents are
read-only and must JOIN before mutation; no implementation delegate receives this
worktree. Parent launches ONE foreground gate-exec payload for preimage comparison,
generation, validation and any restoration, and dispatches NO other write/commit
command in this worktree until that payload and all descendants terminate.
All later authorized commands, including commits and their hooks, are sequenced
AFTER its terminal receipt; a newly observed competing writer cancels admission.
The mutex is cooperative and does not block an unwrapped third-party hook.
If this single-owner reservation cannot be maintained, STOP: do not regenerate
the shared vault or pretend a process snapshot provides lifetime OS exclusion.
No new lock service or hook-policy weakening is introduced.

Verify the archive digest above and extract it into an owned temporary directory.
Enumerate regular files and their sha256 under both vaults; reject symlinks,
unexpected file types and any preimage/current path or byte mismatch BEFORE writes.
Retain that exact preimage unchanged. Run native --changed and both native checks
only under the reservation. Allowed modified set remains the three wiki paths;
zero new/deleted/pruned paths is required for success.
On ANY failed generator or postcheck, nonzero exit, signal, timeout, unexpected
delta, or exception, restore EVERY changed/deleted pre-existing regular file from
the verified pre-run image, including admitted paths. Preserve all newly created
paths for diagnosis, then verify every original name and byte has been restored.
Never claim this is a transactional generator or silently continue after failure.
SIGINT/SIGTERM cleanup inside the payload is best-effort only: gate-exec tears down
its process group and can kill that cleanup. ANY interrupted run with a PENDING
receipt (including SIGINT/SIGTERM, SIGKILL/OOM or missing terminal result) therefore
requires the coordinator, after verifying all children terminal, to restore and
verify the durable preimage BEFORE any further write, gate or commit. No signal
is claimed to guarantee inline cleanup. Failure to restore is a hard stop.

The one NEW durable destination is
`.arbiter/evidence/wiki-preview/2599/actual-run-20260909.json`, operation create.
It contains original command/start/end/exit/signal, exact source SHA and plan/
manifest digest, reservation identity and lifetime, archive digest, pre/post
manifests, allowed-delta comparison, recovery results and executable recipe path.
Persist the pending intent before generation and terminal result before release.
Write each complete receipt to an exclusive same-directory temporary file, fsync
it, rename atomically, then fsync its directory. A stop before terminal rename
must leave the original PENDING receipt and backup locator intact; a stop after
rename leaves a complete terminal receipt. Never truncate the existing receipt.
Receipt acceptance requires BOTH the original payload exit 0 and terminal PASS.
If terminal publication throws, restore the verified preimage and exit nonzero.
Even a PASS-looking file after rename is invalid if directory fsync or the payload
fails; preserve that file and require coordinator recovery before continuation.
once terminal, do not rewrite it for another candidate or run. The historical
preview logs remain immutable and cannot substitute for this receipt.
Before the actual run, exercise the same restoration recipe on owned copies for
admitted-only partial writes followed by exit1 and SIGTERM, deleted originals and
a retained unexpected new file. Checks must distinguish failure from success.
This is a bounded operational recipe using native generation and fs copy, not a
new product module, scheduler or replacement gate.
The executable recipe is the cycle evidence artifact
`/home/luca/work/forma-rooms/portfolio/evidence/arbiter-2599/resume-20260909/wiki-run.mjs`
(SHA256 5ef8886cced822333f91f059691a6eab31353c34ee2076713cf45b9d607d26de).
The original cycle1788909567 recipe remains immutable. The current copy additionally
tests terminal publication failure before rename and at directory fsync after
rename through the same finish function used by the real run. Both reject the
publication and restore original bytes. RED and GREEN logs are retained beside it.
Its `--test` mode already executed exit1, childSIGTERM, and deleted-original plus
retained-new-path cases; all three restore original bytes. That proves only the
isolated recipe, not supervisor-signal cleanup or a real-vault run. A PENDING
receipt is deliberately fail-closed and carries the preserved backup path for
recovery after the whole supervisor group has died.
The 23:38:11Z isolated regression also injected a stop before receipt rename:
PENDING and its backup locator remained readable; terminal replacement was readable.
This is a synchronous injected failure, not a process-group signal or power-loss test.
Those corrections were admitted at 2026-09-09T09:28:57Z; the actual wiki payload
completed at 09:29:39Z. Original failed reviews remain preserved. The receipt
retains its original plan/recipe binding and must not be regenerated for this amendment.
At commit, explicitly `git add -f -- .arbiter/evidence/wiki-preview/2599/actual-run-20260909.json`
after verifying terminal status, source/plan binding and original exits; confirm
`git ls-files --error-unmatch` and the committed blob before L2. No ignore rule
is changed and no historical preview is force-refreshed or reused as this receipt.
## Bounded scanner-classification amendment — 2026-09-09
The ordinary commit stopped on nine generic-api-key findings in the immutable
actual-run receipt. Each equals one of three independently recomputed public wiki
SHA256 digests. Preserve the receipt bytes and every original command result.
The first proposal (nine positional fingerprints) was independently rejected:
a new secret at an ignored coordinate could be hidden. Uphold that finding;
do not install a fingerprint suppression or a whole-file exclusion.

Admit only `.gitleaks.toml`, using Gitleaks' inherited `generic-api-key` rule and
a rule-specific allowlist whose AND condition requires BOTH the exact anchored
receipt path AND a secret equal to one of those three anchored public digests.
All other rules and all other values/paths remain scanned. This follows existing
native public-content-hash false-positive classification, not a temporary secret
waiver; no actual credential is suppressed. Independent review must explicitly
resolve compatibility with INV-31 before applying the configuration. If that
policy does not admit exact public-value classification, stop; do not invent expiry.

Frozen proposed config and runnable regression are retained in portfolio evidence
`arbiter-2599/cycle-1788946697/content-config-amendment.txt` and
`content-regression.mjs`. The native scanner fixture executes original RED,
content-bound staged GREEN, replacement by a new secret AT THE SAME coordinate
RED, the same public hash at another path RED, restored staged GREEN and history
GREEN. All 17 commands terminated with expected exits. Run the real staged scan
before any fresh L1. No dependencies, source generator, emitted consumer or receipt
change is admitted. Fresh plan/code/AC binding, L1 and final integrated L2/CI/CAS
remain mandatory; old wiki execution is historical evidence, not this plan's run.
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
Integration-only wiki refresh: native gen-wiki --check on the merged main input
identified fourteen stale pages at10:07:45Z, corresponding to merged source docs.
The thirteen additional pages in the manifest plus existing Hook Contracts, INDEX
and .wiki-log.json are the only sixteen writable paths. No additions/deletions or
pruning admitted. This is not a rerun or rewrite of actual-run-20260909.json:
its cbb0588d digest and original source/plan/time stay immutable.
Reuse the proven transactional recipe in portfolio cycle1788948146/
wiki-integration.mjs, changing only the explicit allowed-path set, captured current
preimage archive/digest, external receipt destination and source+staged-tree identity.
Archive SHA25602b167826ce019ae3e70e26cbc3f6fd72adf1d39a1048f01fcf602cecb38f8b1.
Run its isolated --test and obtain independent delta approval before actual vault
generation under gate-exec. Same rollback/publication failure controls remain.
Retain the new original terminal receipt externally as integration work evidence;
do not introduce more content-hash suppressions or relabel historical wiki proof.
Integration reconciliation 2026-09-09: main3d729d73 already supplies the native
builder `--out` option and an isolated-output regression. Use that native path,
preserving the unchanged-shared-output assertion from existing5bb7f8ed and the
#2599 lib.mjs parity assertion. Do not reintroduce the older copied-script fixture
or compare a staged merged output with historical pre-merge HEAD bytes. Capture
the qualified input output bytes before the isolated builder runs, as main's
accepted test does; the producer writes only its owned temporary `--out` path.
This reconciles both existing intents without new production behavior. Commit
5bb7f8ed is NOT ancestral to either parent: preserve its already-represented
test protection by content, not by claiming that SHA is in this history. Main's
native --out implementation supersedes the older copied-script fixture approach.
RT-2599-C-01 repair: admit the existing build-kernel-plugin test and add lib.mjs
to its byte-parity list. Run that test alone (no concurrent producer-reader gate).
Capture the unchanged generator's output and require kernel lib.mjs byte parity.
Before full L2, retain the #2597 builder-isolation protection represented in
5bb7f8ed9927e4722c6e14e2e49532ceb9652958 using the merged native --out test above;
do not run the known shared-output collision again. Direct helper regressions
also exercise the retained kernel helper, not just self and rendered template.
Template/render drift and under-testing hunk counters: exercise real git output on
both twins, regenerate kernel and inspect native parity. Main advanced to08bd7d6b;
do not rewrite frozen base solely for unrelated main advance; final integration mandatory.
## Revision
Draft reviewed by author once: explicit inHunk state avoids overloading line0;
multiple-hunk and no-newline controls added before independent review.
Original AC-4: Preserve genuine RED before GREEN, obtain native plan/code/refutation approval and targeted regressions, then exact-head L1/L2, real CI and pr-ff/CAS landing. Rejoin #2597 and requalify its exact artifact/consumer after the prerequisite is fixed.
2026-09-08 AC4-EVIDENCE-GAP amendment: original AC-4 combined pre-verification
proof with future landing/rejoin proof, making truthful native verification admission
circular. Three independent skeptics upheld that gap on 286fd9ab. Its original
delivery requirements are retained above as mandatory postconditions; original
wording is preserved in this Revision section. The issue stays OPEN until all are
met. Update the live issue, verify exact anchor/postconditions equality, then obtain
fresh independent approval of these bytes before implementation.
