---
scenario: drain-wave-of-four
sha: ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf
date: 2026-08-30
persona: A maintainer with four independent small issues who wants one reviewed PR instead of four
steps: 8
findings:
  blocker: 0
  major: 6
  minor: 0
---

# Tabletop — drain-wave-of-four

I have four small, independent open issues and I do not want to review four PRs — I want
`/drain` to batch them into one wave and hand me back one PR, green. I read `/drain` itself,
then the two reference docs it points at, then the batch-execution rule that is supposed to
be what makes parallel write-agents legal at all. The prose is consistent and confident: file-sets
are disjoint by declaration, every agent gets a dedicated worktree, and the wave converges to
one PR. So I go looking for the mechanism behind each of those three promises, the way the
carve-out itself demands ("each is necessary, and any miss voids the exemption"). The distinct-branch
condition holds outright — git itself refuses `worktree add -b` onto a branch that exists, no
further proof needed. The other two do not fare as well: the disjointness check only proves one
group's own touched files are a subset of what it declared, and says so out loud in its own FAIL
message; the worktree-isolation hook only fires once a *second* writer shows up on the main tree,
never the first; and the single-wave-PR promise has no check behind it anywhere I can find. Then
I discover the repo's own audit already proved something worse: the entire hook chain these
promises lean on is silently inert for exactly the delegated-agent dispatch model wave-drain uses.
And the scenario's own named probe, when I run it, confirms none of this — it green-lights an
unrelated review-dispatch matrix and calls it done.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 4 | `.claude/rules/50-batch-execution.md:55` — "**Disjoint file-sets** — the file-sets the agents will touch are declared disjoint in a plan manifest (wave-drain Phase 1) before dispatch," echoed at `.claude/skills/wave-drain/SKILL.md:152` ("file-sets must be disjoint across parallel groups") | `scripts/check-touched-vs-manifest.mjs` is the only script matching `disjoint`/`manifest` under `scripts/`. Its own CATALOG comment (lines 6-7) says: "Pairwise cross-group disjointness is declared but not computed by this check" — it verifies `touched(G) ⊆ declared(G)` for ONE group only. Its own FAIL branch (line 162) repeats: "this single-group check does not prove cross-group pairwise disjointness." Two groups can each individually pass while sharing a file; nothing anywhere computes the pairwise intersection. Confirmed a live, tracked, and previously *closed* gap: issue #2379 accepted "reword the message" over "implement the check" | major | missing-gate | `scripts/check-touched-vs-manifest.mjs` (or a new sibling): compute the actual pairwise intersection of all groups' touched-file-sets on the cumulative wave branch, fail non-zero on any overlap, wire into wave-drain Phase 4 before merge | #2446 |
| 5 | `.claude/rules/50-batch-execution.md:49` — "**Dedicated worktree** — the agent operates in its own git worktree opened via `arbiter worktree open`," and Phase 3 (`SKILL.md:213`): "Spawn **one agent per group** in an **isolated worktree**" | `.claude/hooks/pre-spawn-worktree-guard.mjs:76` — `if (!inWorktree && entries.length > 0) { ...block/warn... }`. This only fires once a write-intent agent is *already active* on the main tree. The FIRST write-intent `Task`/`Agent` dispatch of a session, in or out of a worktree, falls through to the bottom of `main()` and is allowed and registered unconditionally — confirmed by re-reading the full function (lines 40-118): there is no path that blocks a lone write-intent dispatch for lacking `isolation`/worktree `cwd`. The hook's own header is honest about this narrower scope ("spawning a **second** write-intent sub-agent"); the rule and skill cite it as if it enforces worktree isolation outright | major | missing-gate | extend `pre-spawn-worktree-guard.mjs` to flag/refuse a solo write-intent dispatch that is not in a worktree, or reword `.claude/rules/50-batch-execution.md`/`SKILL.md` to state the guard's actual guarantee (no-second-writer-on-main, not mandatory-worktree-for-every-writer) | #2443 |
| 5 | Same two claims as the row above — the mechanism the docs point to for making the carve-out real | `docs/internal/SYSTEM/HOOK-CONTRACTS.md:167-212` (issue #2022) already proved, with two independent reproduced data points (a real subagent `gh pr create` and a real subagent `git commit`, run #2000/PR #2021), that "settings-hook guards were silent for delegated Agent-tool sessions" — the exact dispatch model wave-drain Phase 3 requires ("one agent per group"). The doc's own conclusion: "no Arbiter enforcement claim may rest on a `.claude/settings.json` hook alone." That covers `pre-spawn-worktree-guard.mjs`, `pre-edit-plan-anchor.mjs` and `enforce-gate-before-pr.mjs` alike — every hook this scenario's three promises lean on. Residual gap is tracked (#2233) but neither `/drain`, `wave-drain/SKILL.md`, nor `50-batch-execution.md` mentions it anywhere (`grep -rn "2022" / "delegated.*session"` across those four docs → no output) | major | missing-gate | add a cross-reference from `.claude/rules/50-batch-execution.md` and `.claude/skills/wave-drain/SKILL.md` to `HOOK-CONTRACTS.md#scope-and-threat-model`, naming the CI/branch-protection + git-hooks boundary as the ONLY enforced layer for delegated dispatch | #2233 |
| 6 | `.claude/skills/wave-drain/SKILL.md:249` — the watchdog sweep "reconcile[s] REAL state — `gh pr checks`, `gh issue view`, `arbiter worktree list`, DONE reports" | `node dist/cli.js worktree list` printed 6 "Open task worktrees." `git worktree list` (raw) on the identical tree shows **10** real worktrees. `src/commands/worktree.ts:783` — `worktrees.slice(1).filter((w) => w.branch?.startsWith('task/'))` — hard-filters to `task/`-prefixed branches before printing. Wave-drain's own Phase 4 integration branch, `wave-N-integration` (`SKILL.md:313`), is not `task/`-prefixed and would be invisible to this exact "reconcile REAL state" step, along with any worktree on a non-`task/` branch (observed live: `train/2026-08-30-mb2` plus several `docs/tabletop-*` worktrees) | major | bug | either give `arbiter worktree list` a flag to show all git worktrees (not just `task/`-prefixed), or point the watchdog-sweep step at raw `git worktree list` instead/in addition | #2442 |
| 7 | `.claude/commands/drain.md:37` — "Convergence (owner-ratified 2026-07-10): governed repos → **one wave PR**"; `SKILL.md:362` — "**One PR per wave.**" | `grep -rln "wave-N-integration" / "wave.*PR.*count" / "one.PR.per.wave"` across `scripts/` → no output. `enforce-gate-before-pr.mjs` (the only `PreToolUse` hook on `gh pr create`) checks gate-pass.json freshness for the target worktree's HEAD only — nothing counts or restricts PRs per wave, and per row above it is itself advisory-only for delegated sessions. CI/branch-protection (the actually-enforced boundary) requires `CI Required` green per PR, not single-PR-per-wave convergence. Nothing local or in CI would detect an orchestrator opening N separate PRs instead of one | major | missing-gate | a detective script (local or CI) that cross-references `Closes #N` lines across a repo's open/recently-merged PRs and flags when issues from the same wave roster close via more than one PR | #2444 |
| 8 | `docs/internal/METHOD/TABLETOP-SCENARIOS.md:89-93` — scenario 4's own probe list names "run `node scripts/check-agent-dispatch.mjs`" immediately before the exit criterion about disjoint-file-sets/worktree-isolation/single-wave-PR mechanisms | `node scripts/check-agent-dispatch.mjs` → `[check-agent-dispatch] OK — dispatch matrix matches actual derivation (3 tiers × 5 tracks × 2 modes × 6 pr_types)`. The script's own header (lines 3, 6-10) says it verifies the `(tier × track × review_mode × pr_type)` review-dispatch oracle against `.claude/agent-dispatch-matrix.json` — a real, working gate, but for a completely different domain than this scenario's exit criterion. A maintainer running the scenario's probe list verbatim gets a green "OK" that validates nothing about disjointness, isolation, or PR convergence | major | doc-drift | replace the scenario 4 probe-list entry with `scripts/check-touched-vs-manifest.mjs` plus the (currently absent) pairwise-disjointness and PR-count checks from the rows above, or note explicitly that no probe for this exit criterion exists yet | #2445 |

## Appendix — verbatim probe output

Pinned tree: `ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf`.

Step 4 — the disjointness check's own disclaimer (`scripts/check-touched-vs-manifest.mjs:1-10`):

```
// CATALOG: E7 (#1943, M6 read-set + ADR-103 disjointness) — touched-vs-manifest gate. Context
// CATALOG: economy made checkable: a wave group declares what it will WRITE (manifest `Files` row);
// CATALOG: what a worker actually TOUCHED (git diff --name-only base...branch) must stay inside
// CATALOG: that declared write set. This proves one group's write-set compliance.
// CATALOG: Pairwise cross-group disjointness is declared but not computed by this check.
```

Step 5 — the worktree-guard's actual block condition (`.claude/hooks/pre-spawn-worktree-guard.mjs:76`):

```js
if (!inWorktree && entries.length > 0) {
  const message =
    `[arbiter] SPAWN GUARD: a write-intent agent is already active on the main working tree.\n` +
    `Second write-agent on the main tree is blocked — open a worktree: \`/wt-open\` (ADR-103).\n`
  ...
}
```

Step 5 — the delegated-session finding this repo already proved (`docs/internal/SYSTEM/HOOK-CONTRACTS.md:171-196`):

```
Q1 — Do `.claude/settings.json` PreToolUse hooks apply to subagent Bash calls? Observed:
no. Two independent data points show both event classes are silent: `enforce-gate-before-pr.mjs`
did not intercept real subagent `gh pr create` calls, and `wiki-on-commit.mjs` did not run after a
subagent `git commit`.
...
Local `.claude/settings.json` PreToolUse and PostToolUse hooks are defence-in-depth. They are
advisory for delegated sessions because the harness does not run that hook chain there.
...
Therefore, no Arbiter enforcement claim may rest on a `.claude/settings.json` hook alone.
```

```
$ grep -rn "2022\|delegated.*session\|hook chain" .claude/skills/wave-drain/SKILL.md .claude/commands/drain.md .claude/rules/50-batch-execution.md docs/REFERENCE/wave-drain.md docs/REFERENCE/wave-primitives.md
(no output)
```

Step 6 — the worktree-list gap:

```
$ node dist/cli.js worktree list
Open task worktrees (6):

  task/#2417-self-only-manifest  /home/user/arbiter/.claude/worktrees/agent-a1a8135c2a5eb017f
  task/#2305-restore-preview  /home/user/arbiter/.claude/worktrees/agent-a461fe93fdc7ee56f
  task/#2367-experimental-tools-decision  /home/user/arbiter/.claude/worktrees/agent-a6681a413352b932c
  task/#2353-update-optout  /home/user/arbiter/.claude/worktrees/agent-a99c5a15e08109400
  task/#2416-plugin-add  /home/user/arbiter/.claude/worktrees/agent-a9e253641c565c117
  task/#2434-init-truth  /home/user/arbiter/.claude/worktrees/agent-adf41d760f2642504

$ git worktree list
/home/user/arbiter                                            ae40f0cf [main]
/home/user/arbiter/.claude/worktrees/agent-a1a8135c2a5eb017f  019d44a9 [task/#2417-self-only-manifest]
/home/user/arbiter/.claude/worktrees/agent-a22713f30db0047cf  ae40f0cf [docs/tabletop-drain-wave-of-four] locked
/home/user/arbiter/.claude/worktrees/agent-a29e380e29bbbc8a0  ae40f0cf [docs/tabletop-consumer-upgrade-delta] locked
/home/user/arbiter/.claude/worktrees/agent-a461fe93fdc7ee56f  c5cf8cb0 [task/#2305-restore-preview] locked
/home/user/arbiter/.claude/worktrees/agent-a6681a413352b932c  2df144d3 [task/#2367-experimental-tools-decision] locked
/home/user/arbiter/.claude/worktrees/agent-a99c5a15e08109400  215c05bb [task/#2353-update-optout]
/home/user/arbiter/.claude/worktrees/agent-a9e253641c565c117  72963e9a [task/#2416-plugin-add]
/home/user/arbiter/.claude/worktrees/agent-adf41d760f2642504  93bb69ce [task/#2434-init-truth]
/home/user/arbiter/.claude/worktrees/agent-af95ffc62618a546e  ae40f0cf [docs/tabletop-brownfield-update-go] locked
/home/user/arbiter/.claude/worktrees/train-mb2                d87c1507 [train/2026-08-30-mb2]
```

Step 7 — no wave-PR-count check exists:

```
$ grep -rln "wave-N-integration|wave.*PR.*count|one.PR.per.wave" scripts/
(no output)
```

Step 8 — the scenario's own named probe, green for an unrelated reason:

```
$ node scripts/check-agent-dispatch.mjs
[check-agent-dispatch] OK — dispatch matrix matches actual derivation (3 tiers × 5 tracks × 2 modes × 6 pr_types)
```

## New issues filed during this exercise

- #2442 — `arbiter worktree list`'s `task/`-only filter blinds the watchdog sweep
- #2443 — `pre-spawn-worktree-guard` never requires a solo writer to use a worktree
- #2444 — no mechanism enforces "one PR per wave"
- #2445 — scenario 4's named probe verifies an unrelated axis
- #2446 — cross-group pairwise disjointness still has no mechanism (follow-up to closed #2379)
