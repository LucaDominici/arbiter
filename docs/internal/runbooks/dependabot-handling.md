---
title: 'Runbook — Dependabot PR Triage'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: 'RB-01'
# handles: the invariants this runbook is the operational response to (RB-NN, #2480 wave 8).
# The two invariants a Dependabot PR can violate: the human-approval label (INV-74) and the pinned-action contract (INV-76). This runbook is what an operator does when one of them fires.
handles: [INV-74, INV-76]
tags: ['audience/dev', 'audience/ops', 'kind/runbook']
related: []
---

# Runbook — Dependabot PR Triage

## Background

Dependabot opens two types of PRs:

| Type             | Ecosystem   | Mergeable as-is | INV-74 label | Notes                     |
| ---------------- | ----------- | --------------- | ------------ | ------------------------- |
| `npm_and_yarn`   | npm deps    | yes             | required     | Standard dependency bump  |
| `github_actions` | action pins | **no**          | n/a          | Advisory only — see below |

## github_actions PRs are advisories, not merge candidates (#2300)

Action pins live in two places that must agree:

- `.github/workflows/*.yml` — what actually runs in arbiter's CI
- `src/templates/github/workflows/*.yml.ejs` — the SSOT shipped to governed targets

`action pin parity` (L1, `sync-action-pins.mjs --check`) and
`__tests__/parity/ci-tier-render-parity.test.ts` both fail unless the two sides match.
Dependabot can only edit the first, so **a bump PR is red on parity from the moment it
opens** — measured on run `30420336379`, before any sync commit existed. There is no
ordering that fixes this: an EJS-only PR against main fails parity in the opposite
direction. The two sides must land in one commit.

Until 2026-08-16 a workflow (`dependabot-actions-sync.yml`) papered over this by pushing
the EJS commit onto the bump branch with `contents: write`. That commit touched
`src/templates/**`, so once the #2217 TDD floor landed every bump branch owed TDD evidence
a dependency bump cannot honestly produce, and all four open bumps wedged. The workflow is
deleted; `check-workflow-hardening.mjs` now gates `branchWritebackWorkflows` so no
workflow can reintroduce a push back to its own trigger branch.

### The flow

1. Dependabot opens a **grouped** `github-actions` PR (one per cycle, label `ci`+`deps`).
   Read it as a notification of which pins moved. Expect it to be red. Do not merge it.
2. Drain it as a governed train off `main`:

   ```bash
   git fetch origin
   npx @arbiter/cli worktree open --base <explicit origin/main SHA>   # reads the LOCAL branch otherwise
   # apply the pin bumps to .github/workflows/*.yml (copy from the dependabot PR diff)
   node scripts/sync-action-pins.mjs        # propagate yml → EJS
   node scripts/sync-action-pins.mjs --check
   npm run build && npm run regen && npm run examples:regenerate
   npx prettier --write <regen-touched files>
   ```

3. The train touches `src/templates/**`, so it owes a task id in a commit **subject**
   (`fix(#NNNN): ...`) and verified TDD evidence produced on that branch — same floor as
   any other source change, no exemption. Pair the pin bump with whatever real change the
   task is about, and record evidence for it:

   ```bash
   # write the failing test, commit it, THEN:
   npx @arbiter/cli task init --id '#NNNN'
   npx @arbiter/cli task record-red --test-path <path to the new test>
   # implement, then confirm:
   npx @arbiter/cli verify tdd '#NNNN'
   ```

   Use a **new** issue id for each train and record fresh evidence. Do not reuse a
   previously merged id: `verify tdd`'s `sha-on-branch` check only asserts the recorded
   test commit is an _ancestor_ of your branch, so a merged task's evidence keeps
   verifying forever. Since #2307 the branch floor closes that on **both** citation
   paths — a branch changing `src/` must carry one evidence file PRODUCED on that
   branch, over the union of subject- and body-cited ids — so reusing a merged id now
   fails the gate rather than merely being forbidden by convention.

4. Gate: `npx @arbiter/cli gate-exec -- node scripts/check-all.mjs L2`. Push, merge.
5. Close the dependabot PR pointing at the train:
   `gh pr close <NNN> --comment "landed via <sha>"`.

Note `sync-action-pins.mjs` is **pair-scoped** (only files present on both sides) while
INV-76 is corpus-wide, and it indexes pins by action name keeping the last occurrence —
see #2298. `--check` reporting "in sync" does not prove the corpus is unified; verify with
`node scripts/check-action-pins.mjs`.

### Workflow approval on dependabot PRs

Dependabot PR workflow runs land at `conclusion: action_required` (the repo requires
manual approval before workflows run for that actor). That is why a stale bump PR can show
zero checks rather than red ones. Since these PRs are advisories, leave them unapproved.

## Merging multiple dependabot npm PRs

```bash
gh pr list --author app/dependabot --label deps
```

Each npm bump is a normal PR: it needs the `approved-by-human` label (INV-74) and a green
`CI Required`.

```bash
gh pr edit <NNN> --add-label approved-by-human
```

## Human-side action pin bumps (edit EJS first)

If a human bumps an EJS template pin first (the preferred SSOT-first direction):

```bash
# After editing src/templates/github/workflows/*.yml.ejs
node scripts/sync-action-pins.mjs --reverse  # propagates EJS → yml
node scripts/sync-action-pins.mjs --check    # verify in sync
```

## Gate check

```bash
node scripts/sync-action-pins.mjs --check   # standalone: exit 1 on drift
node scripts/check-all.mjs L1               # full gate including parity check
```

See ADR-051 in `docs/internal/SYSTEM/DECISIONS.md` for the full design decision.

## Vulnerability triage notes (2026-05-20)

When a Dependabot security alert lands on a transitive dep that arbiter
cannot easily override, document the rationale here and proceed.

### Ecosystem-locked vite / esbuild via vitepress (#976)

vitepress 1.6.4 (current latest) bundles its own `vite@5.x` and `esbuild@0.21.x`.
Forcing `vite@6+` via `overrides` breaks vitepress; forcing `esbuild@0.28+`
breaks minimatch ESM imports used by arbiter's pre-edit hooks.

Mitigations available:

- Wait for vitepress 2.x (supports vite 6 / 7), then re-apply overrides.
- vite/esbuild dev-server CVEs are dev-only — the published static site is
  unaffected.

When vitepress 2 ships, run the dep bump as a single PR with full audit + L2.

## Ubuntu-latest gitleaks install (#987)

GitHub-hosted ubuntu-latest does not allow writes to /usr/local/bin without sudo. Install to RUNNER_TEMP/bin and add to GITHUB_PATH.

## evidence-writer.sh shebang (#991)

evidence-writer.sh.ejs uses bash (not POSIX sh) for portable JSON-escape via parameter expansion. awk gsub varies across mawk/gawk/busybox-awk on self-hosted Docker images.
