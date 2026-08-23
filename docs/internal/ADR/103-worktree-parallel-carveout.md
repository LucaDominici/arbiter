---
title: 'ADR-103: Worktree-Isolated Parallel Execution Carve-out'
doc_version: '1.0.0'
status: active
last_review: '2026-08-23'
owner: ''
canonical_id: '103'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/ADR/061-batch-execution-safety-rule-for-parallel-agents.md',
    'docs/internal/ADR/088-ship-as-orchestration-entrypoint.md',
    'docs/internal/ADR/106-codex-track-parity-contract.md',
    'docs/internal/ADR/056-self-dogfood-check-for-ejs-templates.md',
  ]
---

# ADR-103: Worktree-Isolated Parallel Execution Carve-out

**Project:** arbiter
**Date:** 2026-07-10 (decided, #1873) · 2026-08-23 (written, #2330)
**Status:** Accepted

> **This file is a reconstruction, not a recovery.** ADR-103 was decided during #1873 and shipped
> — the rule, the primitives, the CHANGELOG entry and the number all landed in `13bf4ba9`
> ("rule-50 worktree carve-out (ADR-103) + `ship --batch` deprecation (T1 #1873)", PR #1879) — but
> the ADR file itself was never written. It has no add and no delete anywhere in git history. The
> body below is rebuilt from what survived: the rule-50 paraphrase, the `§N` citations embedded in
> shipped code and in issue #1896, the released changelog, and above all the primitives as they are
> actually implemented. **Where the surviving paraphrase and the code disagree, the code wins** and
> the disagreement is recorded verbatim (see [Where the paraphrase and the code
> disagree](#where-the-paraphrase-and-the-code-disagree)).

## Context

Rule 50 (ADR-061) prohibits parallel agents that edit, commit, install dependencies, **create
branches**, or delete — a flat ban, written after R3, the one failure mode in this project with a
confirmed real incident: on 2026-03-01 parallel agents without worktrees produced accidental edits
on `main`, with no clean recovery path.

A flat ban is also the end of multi-agent throughput. #1873 (`wave-drain`) needed N agents writing
code at once. The question ADR-103 answers is not "is parallel writing safe" — it is _"under
exactly which conditions does the R3 hazard stop existing, and what remains unsafe even then."_

The hazard is **shared mutable working-tree state**: one index, one set of tracked files, one
`node_modules`. Git worktrees remove the first two. They do not remove the third, they do not
remove repo-global refs, and they do not make two agents editing the same file safe. So the
carve-out is conditional, and the conditions are necessary, not indicative.

## Decision

### §1 — The carve-out: three necessary conditions

A parallel agent is exempt from ADR-061's edit / commit / branch prohibitions only when
**ALL of the following** hold. Each is necessary; **missing any one voids the exemption**.

1. **Dedicated worktree.** The agent operates in its own git worktree, opened via
   `arbiter worktree open` (`/wt-open`). One agent, one tree.
2. **Distinct branch per agent.** No two parallel agents ever share a branch.
3. **Declared-disjoint file sets.** The file sets the agents will touch are declared disjoint in a
   plan manifest (`wave-drain` Phase 1) **before** dispatch. Overlap ⇒ same group ⇒ serial.

**Still prohibited under the carve-out** — these are repo-global or cross-tree, so worktree
isolation buys nothing:

- **Installing or modifying dependencies** (`package.json`, lockfiles). Solo, serial lane only.
- **Editing the main working tree.** Workers write only inside their own worktree.
- **Creating tags.** Tags are repo-global refs.

#### What actually enforces each condition (stated honestly)

An ADR that overstates enforcement becomes the authority a future agent cites to justify an unsafe
dispatch. So, measured against the tree rather than against intent:

| Condition             | Real enforcement                                                                                                                                                                                                                                                                                                                                                         | Strength                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1. Dedicated worktree | `.claude/hooks/pre-spawn-worktree-guard.mjs` flags a second write-intent agent spawned into the main tree. Its predicate is a **path regex** (`<name>.worktrees/`) plus the harness `isolation: "worktree"` flag — it does **not** verify the tree came from `arbiter worktree open`. Advisory by default; hard only under `ARBITER_SPAWN_GUARD_HARD=1`.                 | Advisory, provenance-blind            |
| 2. Distinct branch    | **Git's** property, not arbiter's: `git worktree add -b` fails if the branch exists, and git refuses to check out one branch in two worktrees. `branchNameFor(taskId, slug)` (`src/worktree/paths.ts:52`) makes the name deterministic per task, so two same-task opens collide. Reachable only via the `runWorktreeOpen` path — a harness-created worktree bypasses it. | Hard, but only on the sanctioned path |
| 3. Disjoint file sets | Declared socially in the plan manifest. `scripts/check-touched-vs-manifest.mjs` proves `touched(G) ⊆ declared(G)` for **one** group, **post-hoc** at harvest, and is not part of `check-all`. Pairwise disjointness _across_ groups — which is what condition 3 actually says — is computed nowhere.                                                                     | Declared; partial post-hoc evidence   |
| Residual prohibitions | **Prose. Zero of three mechanically enforced.** No hook or gate covers `npm install`, a main-tree edit, or `git tag`.                                                                                                                                                                                                                                                    | Convention                            |

This is a deliberate record of the gap, not an endorsement of it. The conditions are policy; the
guards are partial. Anyone tightening them should start with the dependency prohibition, whose
failure mode is described under Consequences.

### §2 — Deterministic leaf primitives; the decision loop stays model-side

The wave protocol is **not** implemented as a TypeScript engine. Explicitly rejected, and still
rejected:

- no `arbiter wavedrain` command,
- no `swarm-drain` skill engine,
- no `src/wave/` core module.

This confirms the "no new TS engine" stance: the multi-issue decision loop — triage, clustering,
grouping, sequencing — lives in the model, inside the `wave-drain` skill. `defaultIssueRunner`
stays un-wired; the harness is what spawns agents (CANON-12).

The boundary:

> **Engine** = a multi-issue decision loop. Prohibited.
> **Primitive** = a deterministic leaf command with no orchestration state and no issue awareness.
> Permitted.

Three primitives were added under this rule, and each is a leaf by construction:

**`arbiter gate-exec [--key K] -- <cmd...>`** — a per-repo gate mutex. `flock(1)` was chosen over
a heartbeat/lockfile scheme because the release is kernel-side: it survives `SIGKILL` and
OOM-kill, which no Node `process.on('exit')` or signal handler can cover. Where `flock(1)` is
absent (macOS base system, Windows) the command **fails closed** with
`E_GATE_MUTEX_UNSUPPORTED` and a serial-fallback hint. There is deliberately **no lockfile
emulation** — it would reintroduce exactly the hole flock was chosen to close.

**Key derivation.** The mutex key is a hash of `git rev-parse --git-common-dir`. Every worktree of
a repo shares the main repo's common dir, so all of them converge on **one** lock. The lock file
lives outside the repo (`$XDG_RUNTIME_DIR/arbiter/<key>-gate.lock`, falling back to the OS
tmpdir): a per-worktree lock would be a null mutex, and an in-repo lock would dirty the trees it
is meant to protect.

**`symlink-children` link strategy** — the `node_modules` default. Every top-level child is
symlinked individually, except transient tool-owned directories (`.vite`, `.cache`, `.vite-temp`,
`.arbiter-test-scratch`), which each worktree creates locally. A whole-directory symlink would
share the Vite/esbuild caches across all worktrees, and N concurrent builds corrupt them into
non-deterministic spurious reds.

**`arbiter worktree prune [--stale <hours>]`** — the zombie reaper. On worker crash nobody closes
the worktree. Candidates are detected from **real state** (the open log plus git), never from
memory: a registered worktree with a clean tree AND (branch fully merged OR no activity beyond
`--stale`, default 24h). Dry-run by default; a dirty tree is never a candidate (INV-96).

### §3 — `ship --batch` is deprecated in favour of `/drain`

Multi-issue dispatch through `ship --batch` is superseded by the `wave-drain` skill and the
`/drain` command, which are where the carve-out is actually exercised.

The deprecation runs on a window rather than a removal: **warn from 0.4.0, remove at 0.6.0**, with
the removal tracked as its own follow-up issue (#1896) one release later. The `IssueRunner` seam
stays synchronous and un-wired — the deprecation removes a _dispatch form_, not the seam.

**Status: executed.** `ship --batch` was removed in 0.6.0 and #1896 is closed. `docs/DEPRECATIONS.md`
carries the ledger row.

### §4 — Lock ordering: `gate-lock ≺ worktree-lock ≺ wave-claim`

`arbiter gate-exec` is a **LEAF**. It acquires only the gate flock, and it must never be invoked
while `.arbiter/.lock` is held. The total acquisition order is:

> **`gate-lock ≺ worktree-lock ≺ wave-claim`**

**`≺` is stipulated here, not derived.** No surviving source fixes its direction, so this ADR
fixes it: `≺` declares acquisition precedence, lowest first. `gate-lock` is lowest and — being a
leaf — is in practice always acquired and released alone. `wave-claim` is highest.

Three honest qualifications, because two of the three elements are not filesystem locks in the
same sense:

- **`gate-lock`** is a real kernel `flock`, and the only **blocking** one.
- **`worktree-lock`** is `.arbiter/.lock`, which is **per-directory** — one file per worktree plus
  one in the main repo, not a single repo-wide lock. Only `runWorktreeOpen` is pinned to the main
  repo, so a worktree agent running `arbiter configure` takes _its own_ lock and excludes nobody.
- **`wave-claim`** is not a filesystem lock at all. It is the GitHub check-**ALL**-then-claim-ALL
  assignee protocol in the `wave-drain` skill (#1378): verify every candidate issue is open and
  unassigned, then claim them all, releasing every claim already taken if any step fails.

Consequently the "anti-deadlock" framing is **nominal**. `acquireLock` (`src/utils/file-lock.ts`)
is fail-fast, not queueing — a lock-order inversion between arbiter's file locks yields
`E_LOCK_BUSY`, never a deadlock. Only the flock can block, and it is a leaf. The order is kept
because it is cheap, legible, and makes the leaf property checkable — not because arbiter's
primitives are capable of the deadlock it names.

One genuine nesting sits **outside** this three-element order: `saveConfig` takes
`.arbiter/kit.lock` _inside_ the command-level `.arbiter/.lock` (`src/utils/config.ts`), with
`acquireLock` reentrant since #1617. That pair is a documented exception, not a violation of §4.

### §5 — Convergence model (owner-ratified, 2026-07-10)

How a wave lands depends on whether the target repo is governed:

- **Governed repos** — **one wave-PR**: all groups integrate locally onto a wave-integration
  branch, one full gate under the mutex, one PR carrying one `Closes #N` line per issue, merged
  only on green CI.
- **Non-governed repos** — **N PRs plus a merge-train**, documented in the skill's cross-repo
  appendix.

The asymmetry is deliberate: the single-PR form depends on a gate and evidence artifacts that only
a governed repo has.

## Where the paraphrase and the code disagree

Until this file existed, `.claude/rules/50-batch-execution.md` was the only statement of the
decision. Two of its sentences describe mechanisms the code does not implement. **The code wins**;
rule-50 has been corrected, and the disagreements are recorded here so the correction is auditable.

| #   | The paraphrase said                                                                                             | What the code does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | "Branch creation is serialized by the worktree open lock, so there is no race on git ref creation."             | `runWorktreeOpen` runs `git worktree add -b` **before** it acquires `.arbiter/.lock`; the lock guards only the `worktree-open.log.json` read-modify-write. The safety property still holds — but it holds because **git's ref creation is atomic and refuses an existing branch**, plus condition 2. The stated mechanism was wrong.                                                                                                                                                                                                                                                                 |
| D2  | "a process never holds two arbiter locks at once."                                                              | False as a general statement — see the `.arbiter/.lock ⊃ kit.lock` nesting in §4. The claim that actually carries weight is narrower, and is true: nothing in `src/` shells out to `arbiter gate-exec` as a subprocess, and `gate-exec` itself takes no `acquireLock` at all, so the one **blocking** lock is never taken while an arbiter file lock is held. Swept across all `.arbiter/.lock` holders (`init`, `configure`, `upgrade-level`, `update`, `doctor repair-state`): none invokes a gate inside the lock scope. This is an **observed fact**, not a guarantee — no gate or test pins it. |
| D3  | `wave-claim` reads as a third arbiter lock.                                                                     | It is the GitHub assignee protocol (§4), with no filesystem lock behind it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D4  | The direction of `≺` is unstated.                                                                               | No source fixes it. §4 **stipulates** it rather than claiming the code forced it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D5  | The `gate-exec` docstring: release is "guaranteed on the flock holder's fd death — including SIGKILL/OOM-kill". | True of **the flock process's** file descriptor — which is not co-terminous with the `arbiter` process. `runInteractive` spawns `flock` as a child of node, so killing the `arbiter` PID orphans `flock`, and the gate keeps the lock. See Consequences.                                                                                                                                                                                                                                                                                                                                             |
| D6  | The 0.5.0 changelog records the rule landing "dual-side (self file + claude template + **codex template**)".    | `src/templates/codex/rules/` no longer exists. ADR-106 made the Codex track _derive_ rule 50 from the Claude template; the arbiter-side copy is `.agents/rules/50-batch-execution.md`, kept honest by `check-codex-self-parity.mjs`. Three copies plus a golden fixture, not three templates.                                                                                                                                                                                                                                                                                                        |

## Consequences

### Positive

- Multi-agent waves became legal and bounded: the R3 hazard is converted into ordinary merge
  mechanics, and every dispatch has a stated condition set to check itself against.
- The primitives are deterministic and independently testable, because none of them carries
  orchestration state (§2). Concurrency correctness is a property of `flock(1)` and of git, not of
  arbiter's own scheduling.
- Condition 3 later acquired partial mechanical backing (`check-touched-vs-manifest.mjs`, #1943),
  and condition 1 an advisory spawn guard (`pre-spawn-worktree-guard.mjs`, #1947) — both built on
  the manifest this ADR made mandatory.

### Negative / residual

- **The gate mutex is a machine-resource serializer, not a correctness mutex over `.arbiter`
  state.** `gate-pass.json`, `.arbiter/.lock` and `findings/` are all per-tree. What it really
  bounds is CPU/RAM/port contention, plus — incidentally — concurrent writes into the shared
  `node_modules`. It must not be cited as protecting shared arbiter state.
- **The dependency prohibition is unenforced and its failure mode is severe.** Under
  `symlink-children`, every top-level child of the worktree's `node_modules` points at the _main
  repo's_ copy. An `npm install` inside a worktree therefore mutates the main repo's copy of every
  already-present package, while newly installed packages land as real directories in that
  worktree only — cross-tree corruption _and_ divergence. This is why the prohibition exists; it is
  worth knowing that nothing stops it.
- **The `-o` trade-off (#2196).** The E2E campaign (2026-08-03) found that the lock fd was
  inherited by every descendant, so a gate that backgrounded a daemon held the repo-wide mutex
  after exiting. #2196 fixed it with `flock -o`. Measured again while writing this ADR: `-o` does
  close the descendant leak, and `flock`'s **parent** retains the lock for the wrapped command's
  whole run — but killing the `flock` process alone now **releases the mutex while the gated
  command is still running**. The failure mode moved from a recoverable stall to a silent
  mutual-exclusion violation in that narrow window. Named here rather than asserted away.
- **Correction to the audit record:** finding F1's caveat — "with `-o` the lock is released the
  moment the command _starts_, so it serializes the gate's start, not its whole run" — is
  **incorrect**. `flock(1)` closes the descriptor in the child only; the parent holds it for the
  full run. `docs/REFERENCE/wave-primitives.md` already states this correctly.
- **Killing `arbiter` does not kill the gate** (D5). `runGateExec` spawns `flock` as a child and
  installs no process-group teardown, so the orphaned `flock` keeps the lock. `arbiter doctor` is
  blind to the gate mutex — it manages only `.arbiter/.lock` and `kit.lock` — so there is no
  supported recovery path short of a manual `/proc/*/fd` scan.
- **A losing `worktree open` leaves a zombie the reaper cannot see.** `acquireLock` is fail-fast:
  on contention the loser has already created the worktree directory, the branch and the link
  children before it dies with `E_LOCK_BUSY` — _before_ writing its open-log entry. Since
  `worktree prune` enumerates only that log, the orphan is invisible to the reaper built to catch
  exactly this.
- **The carve-out does not reach existing consumer projects.** Rule files are emitted with
  `skipIfExists: true`, so a project initialized before 0.5.0 — or one that edited its rule 50 —
  never receives the carve-out and stays governed by ADR-061's flat prohibition.
- The conditions are stronger than their guards (§1). Treat them as policy an agent is expected to
  honour, not as a sandbox that prevents violation.

## Links

- **Amends** ADR-061 (batch-execution safety rule for parallel agents) — its Decision (b) prohibits
  the branch creation §1 carves out. ADR-061 is not superseded: its generator decision and recovery
  protocol still stand.
- Related: ADR-088 (`/ship` as orchestration entrypoint), ADR-106 (Codex track parity — see D6),
  ADR-056 (self-dogfood check, which already cites this carve-out).
- Rule: `.claude/rules/50-batch-execution.md` (SSOT: `src/templates/claude/rules/50-batch-execution.md`).
- Reference: `docs/REFERENCE/wave-primitives.md`, `docs/REFERENCE/wave-drain.md`.
- Issues: #1873 (wave-drain epic), #1879 (PR that shipped the rule and the number), #1896
  (`ship --batch` removal, cites "ADR-103 §3"), #1943 / #1947 (later enforcement), #2196 (`-o`
  fix), #2330 (this reconstruction).
