---
title: 'Backlog drain playbook — analyse, order, cluster, execute'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/method']
related: ['docs/methodology/agent-orchestration-and-context-hygiene.md']
---

# Backlog drain playbook

How to take an open backlog, work out what genuinely comes first, cut it into
parallel-safe clusters, and drive them to merged, verified, pushed work — with
Codex as the implementer and an orchestrating model as the coordinator.

Written from a run that closed 41 issues in three waves. Every rule below exists
because skipping it cost real time in that run.

---

## The shape of it

```
Phase 0  inventory + premise check      ← the phase people skip, and pay for
Phase 1  ordering: what unblocks what
Phase 2  clustering: disjoint file-sets, shared root cause
Phase 3  dispatch: one lead per cluster, Codex implements
Phase 4  integration: rebase → verify in a CLEAN CLONE → merge serially
Phase 5  push once per wave, then close issues with evidence
```

Three or four clusters per wave. More than that and integration becomes the
bottleneck; fewer and you are leaving parallelism on the table.

---

## Phase 0 — Inventory and premise check

Enumerate everything open, then **do not trust what the issues say**.

```bash
gh issue list --state open --limit 100 --json number,title,labels
```

In the reference run, **four of eight cluster leads found their issue's premise
was false**: a gate reported as ungated was already gated; a corruption blamed on
the gate came from a different command entirely; a "blocks every edit on a virgin
tree" did not reproduce on a virgin tree; a "docs silently lost" turned out to be
zero lost files and eight broken references. One issue asked for a change that
would have moved the repo _away_ from the invariant it cited.

So the instruction to every lead is explicit: **falsify the premise before fixing
it.** A cluster that returns "this issue is wrong, here is the measurement" has
delivered more than one that ships a fix for a non-problem.

Separate out, and do not put in a wave:

- **Epics** — decompose them separately or they become mega-diffs.
- **Automated CI alerts** — verify whether each still reproduces on current main.
  Close the stale ones with evidence; replace the live ones with precise issues.
- **Decision issues** — the deliverable is a recommendation with evidence, not code.

---

## Phase 1 — Ordering: what genuinely comes first

Rank by **what unblocks or protects the most**, not by severity label:

1. **Anything red in CI.** A red pipeline makes every later verification
   ambiguous. Fix it or prove it pre-existing and track it — never step over it.
2. **Enforcement that cannot fail.** A gate that passes while verifying nothing
   is worse than no gate: it manufactures false confidence in everything
   downstream. Find these first (a check that skips silently, a scanner keyed on
   a proxy, an audit whose negative branch is unreachable).
3. **Day-1 breakage.** Anything that makes the product unusable on first contact:
   a generator that writes a broken project, a hook that blocks every commit, a
   command that corrupts a user's file.
4. **Fail-open governance.** Silent downgrades, coerced invalid config, promises
   the code does not keep.
5. **Surface and contract.** Documented commands that do not exist, incoherent
   output shapes, dead flags.
6. **Cleanup and dormancy.** Duplicated idioms, uncalled scripts, ratchets
   grandfathered so wide they cannot bite.

Within a cluster, order matters too: fix a scanner's false positives _before_
flipping it to enforce. You cannot enforce something that cries wolf.

---

## Phase 2 — Clustering

Two constraints, both mandatory:

**Disjoint file-sets** — one cluster owns a surface, no other cluster touches it.
This is what makes parallel worktrees safe. Overlap means serialised merges and
semantic conflicts.

**Shared root cause** — the issues in a cluster should be the same defect seen
from several sides. Then one plan, one investigation and one TDD cycle cover four
to six issues, which is where the time actually goes.

Good clusters from the reference run, each named by its cause:

| Cause                                                                 | Issues it covered                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Checks that read a proxy instead of the thing itself                  | commit scope vs task ref; line number vs string; skip spelling vs skip semantics |
| `init` assumes greenfield, single-manager, post-install               | monorepo detection, brownfield baseline, adopt policy                            |
| Config trusts what it reads and normalises silently                   | invalid level coerced, grace window that does not exist                          |
| Hooks key on the wrong thing (basename, prose, tool name)             | five separate hook defects                                                       |
| Nothing measures that signed, tested and published are the same bytes | supply-chain integrity                                                           |
| `update` reasons about additions but never retirements                | orphan files left in every consumer forever                                      |

A cluster of unrelated issues that merely share a directory is not a cluster —
it is a queue, and it will not pay the planning cost back.

---

## Phase 3 — Dispatch

**One lead per cluster.** The lead coordinates, investigates, freezes acceptance
criteria, verifies, and reports. The lead does not write implementation code.

**Codex implements.** Invocation that works reliably:

```bash
codex exec --skip-git-repo-check -s danger-full-access -m <model> "<xml prompt>" < /dev/null
```

- `< /dev/null` is **required** — with stdin open, `codex exec` hangs forever
  waiting for input it will never get.
- Kill a stalled run **by PID**. `pkill -f` on the codex flag string matches the
  caller's own wrapper shell and kills the monitors too.
- If a run stalls with zero output for 13+ minutes, kill and retry; the second
  attempt usually works.

### Model routing

Pick from measured capability, not vibes:

| Model           | Coding agent index | Long-context recall | Use it for                                                                                                                                                                    |
| --------------- | ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.6-sol`   | 80                 | 91.5%               | security and supply chain, long-horizon refactors across a large codebase, anything where the cost of an error is highest. And after terra has failed twice on the same task. |
| `gpt-5.6-terra` | 77.4               | 89.6%               | **default for everything else.** Near-flagship at roughly 40% of the cost.                                                                                                    |
| `gpt-5.6-luna`  | 74.6               | **41.3%**           | single-file, short-context edits only.                                                                                                                                        |

The long-context number is the one that matters, and it is a **cliff, not a
slope**. Luna collapses on multi-file work — and a template plus its `.ejs` twin
is multi-file by definition, so anything touching a generated artefact is out of
its range. Symptoms of using it out of range: runs that leave files half-written,
agents that invent scope restrictions and stop early.

### The lead's brief

Every dispatch should carry:

- The issues, with the instruction to read each one and **falsify its premise**.
- The cause you believe unites them (and permission to disagree).
- The declared file manifest — anything outside it goes to `arbiter note`.
- TDD per issue with a **real** red captured verbatim. A red that fails for the
  wrong reason is not a red.
- Dual-track: every artefact that is also emitted to targets gets its template
  twin changed in the same commit.
- `check-all.mjs L1` green **in the lead's worktree**, never in the main checkout.
- Explicitly: do not push, do not merge, do not close issues.
- The gotchas list below.

### Gotchas to hand every lead

- `npm run build` before running any gate in a fresh worktree — a stale `dist/`
  reds the dogfood check with a misleading message.
- Recreate `node_modules/.vite-temp` and `.arbiter-test-scratch` if a test dies
  with `ENOENT`; fresh worktrees can inherit dangling links.
- Regenerate the wiki (`scripts/gen-wiki.mjs`) if wiki lint reds — it is a local
  artefact, not a commit.
- **Commit hygiene**: a commit whose subject carries `type(#NNN):` owes verified
  TDD evidence. Commits without a separate red commit put `Refs #NNN` in the
  **body** instead. Getting this wrong costs a history rewrite later.
- Never run `arbiter init`/`update` against the arbiter checkout itself.

---

## Phase 4 — Integration

This phase is where the reference run lost the most time. The rules below are
each a scar.

**Verify in a clean clone, not in the working checkout.**

```bash
V=$(mktemp -d) && git clone -q --no-hardlinks <repo> "$V/repo" \
  && ln -s <repo>/node_modules "$V/repo/node_modules" \
  && cd "$V/repo" && npm run build && node scripts/check-all.mjs L2
```

A checkout where agents are working is not a clean measurement surface. A clone
is, and it costs seconds.

**Never run a gate in the main checkout while agents are live.** Two gates in one
tree corrupt each other's temporary state, and a materialising command run there
rewrites tracked files with generic renders.

**Merge serially, rebase each cluster onto the previous.** Expect these conflicts:

- _Baseline files_ (bloat, debt, coverage) — every cluster advances them. Do not
  pick a side: take main's, then **re-measure the merged tree** and advance only
  the number the merged content actually justifies.
- _Golden masters / snapshots_ — do not pick a side either. Regenerate from the
  merged content, then **audit the diff**: hash-only changes are expected; any
  movement in a file-name list must be explained, and nothing should disappear.
- _Semantic conflicts_ — the dangerous ones. In the reference run, one cluster
  extracted a module while another added behaviour to the code being extracted;
  the rebase kept the extraction with the **old** semantics, silently reverting a
  fix. No test caught it. **After every semantic conflict, ask what each side was
  trying to achieve and verify both survive.**

**Expect an L2 residue.** L1 is green in each worktree by construction; the merged
tree still fails L2 checks that only run there: complexity ratchets crossed by the
sum of the clusters, fail-closed annotations, stale bake goldens, emission
coherence. Budget one fix-up pass per wave for this — it is normal, not a defect
in the process.

---

## Phase 5 — Push and close

- One push per wave, from the **verified clone**, with the full gate as the
  pre-push hook.
- Close issues with the merge SHA and how it was verified.
- File every finding a lead surfaced but did not fix — the backlog is the queue,
  not the graveyard. In the reference run the leads surfaced roughly one new
  tracked defect per two closed, and several were more serious than the originals.
- Clean up worktrees and merged branches.

---

## What to watch for in yourself

The failure modes that actually bit, in order of how much time they cost:

1. **Inferring a cause from correlation.** A whole issue was filed on a wrong
   diagnosis (timestamps and a bisection later proved a different command was
   responsible). Measure before you file.
2. **Telling agents a rule and then breaking it.** Instructing every lead never to
   run in the main checkout, then running a regeneration there — a lead caught it
   and said so. If a rule is right for them it is right for you.
3. **`git add -A` after a materialising command.** It stages generated residue as
   if it were work. If a path shows as an _addition_ you did not author, check a
   clean clone before staging it.
4. **Committing without checking which branch is checked out.** A tool can leave a
   branch active; a commit lands there and the verification in a clone keeps
   failing for reasons that make no sense. The reflog finds it in seconds.
5. **Trusting a lead's green.** They measure at their base; main has moved. Re-run
   the gate yourself after every rebase, before every merge.

---

## Invocation

```
Leggi docs/methodology/backlog-drain-playbook.md ed eseguilo sul backlog aperto.
```

That is the whole prompt. Everything the run needs is above.
