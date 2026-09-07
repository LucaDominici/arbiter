---
title: 'CI/CD Developer Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# CI/CD Developer Reference

This document covers the W4 CI tier baseline: what was built, how it works, and how to maintain it.

## What is W4

W4 is the fourth wave of arbiter's Planning Skeleton Migration. It relights arbiter's own self-CI (nuked to zero in #862) with a minimal 5-workflow baseline that also ships as a generated framework feature for target projects.

**Self-CI baseline (arbiter-self):** 4 canonical workflows under `.github/workflows/` — this is `migrationStatus: 'transition'` per INV-73. W10 completes the remaining 4 canonical workflows.

**Target project baseline:** `ciTierMode: 'baseline'` emits 6 workflow files (01, 02, 03, 09, \_notify, \_label-sync). `ciTierMode: 'full'` emits all 10 (8 numbered + 2 helpers).

## Dual-Track Contract

W4 ships two tracks in one PR:

- **Track A (arbiter-self):** Hand-authored `.github/` files that represent what arbiter uses for itself.
- **Track B (framework):** EJS templates + generator + labels + composite action so `arbiter init` can emit the same files for target projects.

The parity test (`__tests__/parity/ci-tier-render-parity.test.ts`) enforces byte-equivalence between committed Track A files and the rendered Track B templates. If you edit a template, re-render the committed file to keep parity.

### Node version SSOT

Every CI-enabled project emits `.nvmrc` as its Node version source. All workflow
Node setup steps use `node-version-file`; TypeScript alone enables the npm cache
and dependency install, while non-TypeScript governance jobs use setup-only Node.

## Re-rendering after template edits

```bash
# render committed workflows from the frozen fixture
node -e "
const { renderTemplate } = await import('./dist/utils/render.js')
const fixture = JSON.parse(require('fs').readFileSync('__tests__/fixtures/ci-tier-render-context.json', 'utf-8'))
const wf = renderTemplate('github/workflows/01-pr-fast.yml.ejs', fixture)
require('fs').writeFileSync('.github/workflows/01-pr-fast.yml', wf)
"
```

Or run `make generate` (if available) which calls the full generator.

The frozen fixture is `__tests__/fixtures/ci-tier-render-context.json` — edit it only when arbiter's own config changes. It uses `ciTierMode: 'baseline'` to match the self-CI setup.

## Key Scripts

| Script                                       | Purpose                                                                | Level |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| `scripts/check-ci-tiers.mjs`                 | Self CI tier presence gate (4/8 canonical required in transition mode) | L1    |
| `scripts/check-action-pins.mjs`              | Assert all Actions are SHA-pinned (INV-76)                             | L2    |
| `<project>/scripts/check-workflow-perms.mjs` | Assert all workflows declare top-level permissions (INV-77)            | L1    |
| `scripts/check-local-ci-parity.mjs`          | Assert local Makefile targets match CI workflow steps (INV-87)         | L1/L2 |

`check-local-ci-parity.mjs` validates level parity bidirectionally (#2042): every `check-all.mjs`
check ID needs a `CI_COVERAGE`/`CI_SKIP_SET` entry, and every `CI_COVERAGE` job-name value must be
a real, current job in `.github/workflows/*.yml` — catching a job rename that would otherwise
silently desync the map.

Run all checks:

```bash
node scripts/check-all.mjs L1   # fast gate
node scripts/check-all.mjs L2   # full gate including SHA pins
```

Inspection flags (#2078, GATE-1 of #2041), for iterating on a single failing check without paying for the whole suite:

```bash
node scripts/check-all.mjs L2 --dry-run     # print which checks WOULD run at this level, spawn nothing
node scripts/check-all.mjs L2 --gate "be-lint"  # re-run one check by its display name
```

Neither flag ever writes gate-evidence/result JSON — a dry-run or single-check rerun must not be able to fake a green gate for a fail-closed consumer (e.g. a Stop hook or the pre-push evidence check). Use them to iterate; the merge-blocking evidence still comes from one full, flag-free run.

## The per-repo gate mutex (#2427)

Only one gate may run in a repository at a time. `scripts/check-all.mjs` re-execs itself under
the mutex, and the generated `.githooks/pre-push` launches the gate through it, so the lock is
held for the whole run rather than for a fragment of it.

The incident it exists for: a `git push` was killed while its pre-push L2 was running. The
orphaned gate kept going, the branch took another commit, and a second push started a SECOND L2
in the same worktree. The two interfered — `docs:build` tripped over a half-deleted VitePress
temp file and a subprocess-heavy unit test flaked under the doubled load — and the orphan
finished green and stamped a marker for a tree it had never fully tested. **A green marker for
an untested tree is the failure this prevents**, not merely the wasted CPU.

The lock key is the sha256 of the resolved `git rev-parse --git-common-dir`, first 16 hex
characters, under `$XDG_RUNTIME_DIR/arbiter`, acquired with `flock(1)`. Keying on the _common_
dir means sibling worktrees of one repository share a lock, which is what makes the guarantee
per-repository rather than per-directory.

Two implementations exist by necessity, not by accident: `src/commands/gate-exec.ts` owns the
contract, and `scripts/lib/gate-mutex.mjs` reproduces its key derivation for `.mjs` land — the
pre-push hook and `check-all.mjs` must run in a consumer checkout that has no arbiter `dist/`
at all, and `dist/` ships without `scripts/`. `__tests__/scripts/gate-mutex.test.ts` pins the
two derivations byte-for-byte so they cannot drift.

Signals behave the way a developer expects: the gate runs in the wrapper's own process group —
no `setsid`, no `detached`, no background `&` — so Ctrl-C reaches the gate exactly as it reaches
`git push`. A pid-targeted signal is forwarded down the descendant tree, and SIGKILL, which
cannot be trapped, is covered by the independent orphan guard in `scripts/lib/run-helpers.mjs`
armed through `ARBITER_GATE_PARENT_PID`.

Lock ordering is unchanged (ADR-103 §4): the gate lock is a **leaf**, never taken while
`.arbiter/.lock` is held. Total order is gate-lock ≺ worktree-lock ≺ wave-claim.

## Gate evidence is bound to the tree it measured (#2427)

A gate-pass marker is not a token that says "a gate passed once". It records the conditions it
was produced under, and a consumer re-verifies them before trusting it. A marker is refused when:

- `checkout_root` differs — **evidence does not travel between worktrees**;
- `toolchain_fingerprint` differs — a lockfile or the installed toolchain changed since the run;
- `tree_hash` differs — the working tree changed since the gate ran.

Each refusal names which condition failed rather than reporting a generic invalidation, so the
fix is obvious from the message. The point is that a marker cannot outlive the state it attests
to: edit a file after a green gate and the marker stops being accepted, which is precisely what
the killed-push incident above produced by accident.

## The acceptance-criteria anchor gate (INV-138, #2405)

Governed projects now receive `scripts/check-acceptance.mjs`, wired into the emitted gate
registry as `acceptance anchor (INV-138)` — **L2, advisory (`warn`)**.

Where the rest of the gate certifies _mechanics_, this one anchors _intent_. During the
implementation phases the active task's plan must freeze the issue's acceptance criteria as
explicit `AC-N` ids plus non-goals; at verification and close a reviewer-written fit artifact
(`.arbiter/evidence/ac-fit/<task>.json`) must exist with every criterion `PASS` and a cited
evidence line. That is the mechanical form of **"an unproven criterion is a REJECT"** — green
tests say the code does what it does, not that it does what was asked.

**It is inert unless you turn it on.** Three layers of default-off, deliberately:

- gated on `features.acceptanceAnchor` in `arbiter.json`, with `ARBITER_ACCEPTANCE_ANCHOR=1/0`
  as an env override;
- `warn` rather than `check`, so even enabled it advises rather than blocks;
- **vacuous exit 0 with no active task**, which is what keeps `main`, CI on merged trees and
  fresh clones green.

Exit codes follow INV-53: `0` PASS or SKIP, `1` FAIL (anchor or fit missing/invalid), `2` ERROR.

Two direct invocations exist beyond gate mode: `--plan <path>` validates a plan on its own
(used by wave integrate) and `--ac-fit <path>` validates one fit artifact. The wave loop's
own readiness use of INV-138 is described in `wave-drain.md`; this section covers the gate
that consumers receive.

It is a separate script rather than a fold into a neighbour, and the reasons are recorded in
the script's own CATALOG lines: `check-phase-doc-consistency.mjs` validates the _shape_ of
`.claude/.task/status.json`, while this validates the _content contract_ between the anchored
plan, the issue's criteria and the reviewer's fit evidence — a different SSOT axis with its own
feature-flag lifecycle; and `check-evidence-bundle.mjs` validates per-task artifact bundles
under `.evidence/` against their own schema, which knows nothing about plan parsing.

## Generated gate guard artifacts

The generated `check-all.mjs` classifies optional guard files using
`.arbiter-generated-manifest.json`, not filesystem existence alone. A guard that is present runs;
a guard recorded as emitted but later deleted produces a hard `FAIL`; a guard never emitted remains
a normal `SKIP`. If the manifest is absent or invalid, the gate prints a loud `DEGRADED` line and
cannot classify the missing guard. Arbiter's own committed conformance and doc-set guard scripts
are required directly, so deleting either cannot silently turn the check into a skip.

## Labels

`.github/labels.yml` is the canonical label list. It is generated by `renderTemplate('github/labels.yml.ejs', config)` and synced to the repo by `_label-sync.yml` on every push to main.

Label categories (W4):

- Size labels: `size/XS`, `size/S`, `size/M`, `size/L`, `size/XL`
- AI governance: `ai-generated`, `human-approved`, `human-review-required`
- CI tier: `tier:baseline`, `tier:full`
- Lifecycle: `tech-debt`, `follow-up`, `blocked`

## INV-73 in Transition Mode

`src/invariants/catalog.ts` INV-73 carries `migrationStatus: 'transition'` and `minPresent: 4`. This is arbiter-self only — the catalog filter does not expose `migrationStatus` to target projects (they always see the full 8/8 contract).

To flip to `complete` when W10 ships: update `migrationStatus: 'complete'` in the catalog and update `scripts/check-ci-tiers.mjs` to require 8/8.

## Branch Protection

After the W4 PR merges, run:

```bash
gh api PUT /repos/LucaDominici/arbiter/branches/main/protection \
  --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci-required", "human-approval-required"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

This binds the 5 baseline workflows as required status checks (INV-74 anti-bot gate).

## Composite Action

`.github/actions/setup-node-pnpm/action.yml` is a composite action that:

1. Sets up Node (version from `.nvmrc`) with the npm cache
2. Runs `npm ci` — skip with the `install: 'false'` input for setup-only jobs

Referenced in workflows as `uses: ./.github/actions/setup-node-pnpm`. It pins a
single canonical `actions/setup-node` SHA, so the per-job `setup-node + npm ci`
boilerplate lives in one place (#1131). The directory name is historical — the
action uses npm, not pnpm. Node-only jobs (PII/secret scans, change classify,
action-pin audit) and the publish job (which needs `registry-url`) keep their
own inline `actions/setup-node`.

## Heartbeat Watchdog

`09-heartbeat-external.yml` (and its template `09-heartbeat.yml.ejs`) runs daily at 06:00 UTC and checks:

- Nightly workflow ran within 26h
- Weekly workflow ran within 8 days
- Monthly workflow ran within 35 days

In `ciTierMode: 'baseline'` (EJS guard `locals.ciTierMode === 'baseline'`), missing workflows produce a WARN instead of `exit 1`. This allows the heartbeat to run safely before all 8 workflows are present.

When a check fails, the workflow creates a GitHub issue labeled `heartbeat-nightly-missed` / `heartbeat-weekly-missed` / `heartbeat-monthly-missed`. Duplicate issues are suppressed.
