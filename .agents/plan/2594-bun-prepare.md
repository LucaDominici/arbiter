---
title: '#2594 Bun Git prepare repair contract'
doc_version: '1.1.0'
status: active
last_review: '2026-09-08'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/agent', 'kind/plan']
related: ['#2594', '#2578']
---

# #2594 Bun Git prepare repair contract

Source/base: `ff7d57705f0194bf959ac4b10491e300ae4e7d76`.

Recovery amendment, 2026-09-08: the preserved implementation candidate is
`def265e78ac58a43c9199e2ee40c29839a6a1e51`. Its old RED receipt does not replay:
it pins the base before the seventh test existed. Its old plan review did not
check the mandatory native sections. Neither gap is retrospectively approved.
This amendment repairs the plan contract, not the missing historical proof.
The integration writer remains in `2594-bun-git-prepare`; no #2578 files change.

## Acceptance Criteria

The live issue's four criteria below are verbatim. Stable numeric ids were
added to the issue this cycle; its four criterion texts are unchanged.

- [ ] AC-1: A Git dependency install under Bun with trust scoped to `@arbiter/cli` builds the project-local `node_modules/@arbiter/cli/dist/cli.js` without an ambient compiler or a global install.
- [ ] AC-2: The lifecycle bootstrap obtains the package's declared build tooling through a deterministic package-manager command, without recursion or a blanket lifecycle bypass; ordinary contributor installs still do not build.
- [ ] AC-3: Focused lifecycle regressions cover missing compiler bootstrap, existing `dist/cli.js`, npm Git-cache and contributor paths.
- [ ] AC-4: A real isolated Bun install of the exact candidate executes the fixed local CLI against a non-vacuous document command. Package publication/adoption and #2578's generated-wrapper acceptance remain open.

## Non-Goals

- Touch only `scripts/prepare-lifecycle.mjs`, its focused test, the installation note in `docs/QUICKSTART.md` required by the native docs gate, and necessary native plan/evidence metadata.
- No runtime dependency, broader trust, installer framework, forced consumer manager, `file:`/`link:` coordinate, publication claim, or change to #2578's frozen 81-path manifest.
- Git loopback is a scoped pre-push behavioral test, not proof of a publicly resolvable coordinate.

## Approach & decomposition

The only production change is in `scripts/prepare-lifecycle.mjs`. When this
package is a dependency, `dist/cli.js` is absent, and its local
`node_modules/.bin/tsc` is absent, run exactly
`npm ci --include=dev --ignore-scripts` in the package root before the existing
`npm run build`. `npm ci` consumes the committed lockfile and the scripts flag
prevents prepare recursion; the build command itself receives no scripts bypass.
If bootstrap fails, fail prepare and do not run the build. Existing dist, a
compiler already present, and ordinary contributor checkouts remain no-op.

The last sentence refers to bootstrap: an existing compiler still follows the
pre-existing dependency build path. Reuse the current synchronous lifecycle
helper; do not add a second installer or change package-manager selection.

## Threat model & abuse cases

Dependency prepare is an execution boundary. Trust stays limited to the named
package. Only the dependency's committed lockfile supplies build tooling; the
bootstrap disables dependency scripts to prevent recursion, while the explicit
build remains enabled. Do not accept ambient `tsc`, expand trusted packages,
or hide a bootstrap/build failure behind successful installation status.

## Input validation

Reuse the existing dependency-location and file-existence checks. Commands use
literal argv and the package root, not interpolated shell input. An invalid
lockfile, missing npm, unavailable registry or failing build must stop prepare;
no retry loop, global install or success fallback is added.

## Idiomatic patterns & pitfalls

Reuse Node `existsSync`, `join` and `execFileSync`. Preserve the current
dependency-location semantics, including npm Git cache. A Bun exit zero does
not establish AC-1/4 without the installed file and executed command. Invoke
native gate-exec from the candidate's built CLI: the main checkout's stale
dist currently lacks held-lock propagation and self-deadlocks on nested L2.

## Test strategy

TDD proof adds the missing-compiler dependency fixture to the focused lifecycle
test. The stub must record ordered argv: bootstrap first, then build; the test
must show `--ignore-scripts` belongs only to the bootstrap call. Preserve the
existing npm-cache, existing-dist and contributor paths. Record actual RED in
`.arbiter/evidence/tdd/#2594.json` before implementation.

AC-2/3 map to the focused lifecycle suite; AC-1/4 map to the real isolated Bun
run below. Recovery must preserve def265e7 and the original invalid receipt,
then replay the original fix through a genuinely committed test-only RED and
native `task record-red`, with today's timestamps, before GREEN. Do not invent
a historic test commit, force the recorder, or merely edit the pinned SHA.
Keep the same frozen base and source patch; any transport or behavioral finding
must be resolved before treating this recovery recipe as implementation-ready.

Coordinator resolution of AR-2594-01/02, 2026-09-08: preserve def265e7 and its
invalid receipt via an immutable recovery ref before changing HEAD. In this same
integration worktree use a new task-form recovery branch from frozen ff7d5770,
carry this plan/manifest forward, and use the native backward transition
(`node dist/cli.js task advance --to plan --reverse`) out of refactor. Run the
fresh plan-review, then enter `red-team-review` with
`node dist/cli.js task advance --to red-team-review`; only fresh red-team
evidence permits `node dist/cli.js task advance --to red`.

Impact record, 2026-09-08: no fresh `graphify-out/graph.json` exists, so the
native ripgrep fallback was used (`impact-1788827892.log`).
`scripts/prepare-lifecycle.mjs` has direct package lifecycle and focused-test
dependents, exceeding the S leaf ceiling. The recovery is therefore
**Standard**, not S: obtain a fresh plan-review and three independent
red-team results against this amended digest before entering red. The plan and
manifest runtime artifacts are themselves consumed by parity/gate paths and
are retained only as native contract artifacts, not implementation scope.

The authoritative task state is `.claude/.task/status.json`: it was rebound to
`task/#2594-bun-git-prepare-recovery` and transitioned from `refactor` to
`plan` using the explicit reverse command above on 2026-09-08. Activate the
existing opt-in native plan gate with `.arbiter/plan-review.enabled`; before
moving to `red-team-review`, a fresh independent PASS must be recorded at the
native sanitized-task path `.arbiter/evidence/plan-review/_2594/latest.json`
with this plan's exact digest.
For Standard red-team, record three independently stamped raw returns and
compile `.arbiter/evidence/redteam/#2594.json` with task, recovery branch,
base SHA, plan SHA/digest, timestamp, reviewers and findings. The coordinator
validates every binding before advancing. This bundle proves the plan/base only;
the later GREEN SHA needs its own TDD, AC-fit, review and gate receipts.

Commit only the missing-compiler test with an issue-linked subject
and explicit AC mapping; run `task record-red` without force. Apply exactly the
preserved production hunk for GREEN, run composed L1 before its commit, and
verify RED replay. The new GREEN SHA must receive the Bun/AC proof and native
exact-head qualification; def265e7 proofs do not silently transfer. Preserve
the current round-2 review state: repair its findings and review the recovery
delta, not a third unchanged full review or a reset of the review counter.
This is an adopted recovery sequence, not approval of unexecuted recovery.

## Risks

The additional bootstrap requires npm and registry access during Git prepare;
this is explicit and bounded by the existing synchronous lifecycle. A local
Git transport probe may fail before prepare and must be classified separately.
The current candidate is not landing-admissible: fresh native plan/red-team
reviews, replayable RED provenance, issue-linked commits, code review/adversarial
AC fit, composed L1, exact-head L2, live green CI and pr-ff/CAS admission remain
required (INV-08/23/24/25/26/27/53/138). Prior phase timestamps remain historical.

After code review and gates, a fresh temp consumer runs Bun 1.3.9 with trust
limited to `@arbiter/cli` and the committed candidate's full Git SHA. It asserts
the fixed local `node_modules/@arbiter/cli/dist/cli.js`, then executes that file
against a minimal non-vacuous `doc-set --strict --json` fixture. Retain command,
exit, candidate SHA and installed CLI hash. This verifies #2594 only; #2578
wrappers, package publication and consumer adoption remain separate.
