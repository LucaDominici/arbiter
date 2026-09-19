---
title: 'Task Recovery Reference'
doc_version: '2.1.2'
status: active
last_review: '2026-09-10'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Task Recovery Reference

**Issues:** #690, #694, #1206
**Commands:** `arbiter lifecycle resume`, `arbiter lifecycle recover`, `arbiter ship`

Use this when a session interrupted mid-task and you need to know where to pick up.

---

## Quick Command

```bash
arbiter lifecycle resume
```

Reads the unified task document (`.claude/.task/status.json`, see below) and prints where to resume.
If a step-cursor was set, resume lands on the **exact** next action; otherwise it falls back to
phase-level recovery guidance.

---

## Pinpoint resume — the step-cursor (#1206)

`arbiter lifecycle resume` is phase-granular by default. For an interrupted session to resume at the EXACT
sub-step (not "you were somewhere in green"), drop a step-cursor as you work.

Write the cursor through the single lifecycle writer:

```bash
arbiter lifecycle checkpoint --tdd GREEN \
  --last 'wrote failing test for validateEmail' \
  --next 'implement validateEmail in src/validators.ts' \
  --digest 'RED proof recorded; implementation next'
```

After a mid-task `/clear`, `arbiter lifecycle resume` reads the cursor from disk and prints:

```
Phase: green (GREEN)
Last action: wrote failing test for validateEmail
Next action: implement validateEmail in src/validators.ts
```

The cursor lives in the single unified document, so resume is exact — not inferred from the
filesystem.

---

## Orchestrated runs — `/ship` (orchestration entrypoint, #1216)

`/ship #NNN` (Claude Code) / `arbiter ship <id>` (CLI) is the **single orchestration entrypoint** —
it drives an issue to a reviewed, merged PR by auto-sequencing
(worktree → mechanical plan admission → TDD implementation → final review → gate → merge → cleanup).
Use `/task` subcommands (`arbiter lifecycle advance`, `record-red`, etc.) only for recovery or manual
phase control; the `/ship` loop auto-advances phases when their gates are green.

`arbiter lifecycle record-red --test-path <path>` records only a genuinely failing test run. A runner
that exits 0 is rejected, and Node's `node:test`/TAP failure summary is recognized via `# fail N`.
Playwright's `line`/`list` reporters are recognized via their `N failed` summary, with N ≥ 1 so
`0 failed` never becomes red evidence.
Commit the RED test before recording it so the evidence can be correlated to the test commit.
On a declared train, `--task-id #NNN` may select only the active task or an exact member of the
state document's `chainIds` array; malformed `chainIds` data and undeclared secondary IDs are
rejected before the test runs or any evidence is written.

`arbiter check tdd '#NNN'` replays the recorded command at the RED commit and requires
a completed nonzero exit. It compares a sorted multiset of actual JavaScript `FAIL` headers,
independent of file execution order. Vitest project badges remain part of each failure identity, and
repeated failures remain separate occurrences. Missing, additional, changed or wrong-project failures
reject replay; quoted or indented diagnostic text cannot substitute for a failed test. Checkout paths
and terminal color are normalized. Only Vitest's black-foreground/background badge framing normalizes
to the existing pipe-label form; arbitrary terminal styling remains rejected. The retained V1 log
supplies these identities without an evidence migration; other runners retain their existing summary
signatures.

In Arbiter's own repository, `node scripts/check-all.mjs L2` prepares `dist/` with one
`npm run build` before dependent checks. A failed or skipped build stops those checks and
writes a failed gate result. No separate build or coverage pre-run is needed: L2 runs the
unit corpus once with coverage. L1 keeps its lightweight kit preparation.

At L2, `check-tdd-evidence.mjs` treats a branch as docs-only only when every changed path is on its
documentation allowlist: a root documentation file (except `AGENTS.md`), or a documentation file
or visual asset under `docs/` or `wiki/`. Any other path is a non-documentation change and must
satisfy the branch TDD-evidence floor; this is intentionally not inferred from whether a path
contains `src/`.

The positional `<id>` accepts both `1280` and `#1280`: it is normalized to the canonical `#NNN`
form once at parse (#1280), so the persisted task id always matches the TDD-evidence schema
(`^#\d+$`) and its identity check. Non-numeric ids are rejected with an error.

---

## Context-Rot 3-Layer Recovery (#694)

When a session is auto-compacted or `/clear`-ed mid-task and `arbiter lifecycle resume` is not enough:

```bash
arbiter lifecycle recover               # uses .claude/.task-id
arbiter lifecycle recover --task #694   # explicit id
```

Output assembles three layers of recovery context:

| Layer | Source                                                          | What it gives you                                          |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | `.arbiter/evidence/<sanitized-task-id>/BACKLOG.md` (if present) | Free-form notes the previous session pinned for itself     |
| 2     | `git log -F --grep 'CHECKPOINT(#<id>)'` (last 10)               | Commits explicitly tagged as recovery checkpoints          |
| 3     | `git log` (last 20 commits)                                     | Fallback context — what was happening in the repo recently |

The footer always prints the MCP manual-recovery instruction in case the three layers aren't enough.

### BACKLOG.md authoring

Drop a markdown file with whatever the next session needs to know:

```bash
mkdir -p .arbiter/evidence/_694
cat > .arbiter/evidence/_694/BACKLOG.md <<'EOF'
# Backlog for #694

## What's done
- Layer-1 scaffolding shipped

## What's next
- Wire CLI subcommand
- Update task-recovery.md
EOF
```

Task ids are sanitized to `[a-zA-Z0-9_-]` (cap 64 chars) — `#694` becomes `_694`. The `.arbiter/` directory is gitignored, so the backlog stays local.

### CHECKPOINT commit convention

Tag any commit you want surfaced by Layer 2:

```bash
git commit -m "CHECKPOINT(#694): refactor dispatch.ts before context window fills"
```

---

## Phase Recovery Table

| Phase           | What Happened                       | Recovery Action                                                                                                                                                       |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`     | Task not started                    | Run `/task #NNN` to initialize branch and plan                                                                                                                        |
| `plan`          | Plan being written                  | Check `.claude/plans/` for the active plan; complete mechanical admission, then advance to `red`                                                                      |
| `red` / `green` | TDD cycle in progress               | `arbiter lifecycle resume` (lands on the cursor if one was set); run targeted tests while editing                                                                     |
| `refactor`      | Candidate being frozen and reviewed | Freeze the SHA, run targeted certification, then record the independent final reviewer panel and per-AC acceptance fit                                                |
| `verification`  | Final qualification running         | Run one full gate; `.arbiter/gate-pass.json` must bind the exact HEAD, branch, task, tree, toolchain, level and TTL before the phase advances                         |
| `close`         | CLOSER mode                         | The same current gate-pass marker is required before entering the phase; commit, push, and land the PR                                                                |
| `complete`      | Task done                           | The same current gate-pass marker is required before entering the phase; verify PR created: `gh pr list --head $(git branch --show-current)` and confirm issue closed |

---

## The unified task document (#1206)

All task state lives in **one** authoritative document pair at a fixed path (one active task per
working tree). The legacy split-brain — flat `.claude/.task-*` dotfiles plus a per-id
`.claude/.task-{sanitized}/status.json` — has been collapsed into it. Reading a tree that still has
the legacy files migrates it transparently (seed + delete) on first access.

```
.claude/.task/status.json   structured state — single atomic writer
.claude/.task/log.md         append-only digest (every phase transition + every cursor update)
```

`status.json` schema:

```json
{
  "taskId": "#NNN",
  "phase": "green",
  "tier": "Standard",
  "plan": ".claude/plans/task-NNN.md",
  "cursor": {
    "tddPhase": "GREEN",
    "lastAction": "wrote failing test for validateEmail",
    "nextAction": "implement validateEmail in src/validators.ts"
  },
  "runId": "12345-1715817000000",
  "timestamps": { "plan": "2026-05-16T00:08:00.000Z", "green": "2026-05-16T00:08:30.000Z" },
  "gateDecisions": []
}
```

| Field               | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `taskId`            | Active task id (was `.task-id`)                                                        |
| `phase`             | Current lifecycle phase — authoritative, single writer (was `.task-phase`)             |
| `tier`              | Task tier XS/S/Standard (was `.task-tier`)                                             |
| `plan`              | Repo-relative path to the plan file (was `.task-plan`)                                 |
| `cursor`            | Step-cursor (no CLI writer since the T2 cut — see above) — drives pinpoint resume      |
| `timestamps`        | ISO timestamps per phase entered (accumulated across sessions)                         |
| `runId`             | `<pid>-<epoch-ms>` — unique per process invocation                                     |
| `gateDecisions`     | Gate pass/fail records                                                                 |
| `hostBinding`       | Exact checkout identity established by host preflight; Claude session data is optional |
| `collaborationMode` | Schema-validated delivery mode used by local review guards                             |

Writes route through `writeUnifiedState`, a read-modify-write over `writeFile` (`atomicWrite`): every
update merges all prior fields (a phase advance never clobbers the cursor or cost), and the temp file
is registered for SIGTERM/SIGINT cleanup (#613). Shell consumers read fields via
`arbiter lifecycle get --field <phase|taskId|tier|plan|tddPhase|lastAction|nextAction>` and seed state via
`arbiter lifecycle start --id #NNN --tier <tier> --plan <path>`.

Prefer the checkout created by the active host (Claude, Codex, or a manual Git workflow), then run
`arbiter worktree prepare <id> [path]` and
`arbiter lifecycle preflight --id <id> --worktree <path>` before `task init`. Adoption binds the
native checkout to Arbiter's existing resource policy without transferring cleanup ownership.
`git worktree add` remains the fallback for hosts that cannot create an isolated checkout.
Lifecycle writes and qualified review/acceptance evidence reject a different binding id, root,
task, or branch; when Claude session data exists, its session and transcript must also match.

Final review evidence is recorded once per routed panel with
`record-agent-return.mjs --mode reviewer-panel`; the recorder derives panel size from the frozen
diff and the validated `collaborationMode` persisted by `task init`. Trunk-solo Standard work uses
one independent reviewer, collaborative Standard work uses two, and routed sensitive changes still
require three. Missing task state keeps the stricter collaborative default; the recorder never trusts
raw configuration. Generated projects, which intentionally do not include the router, use the same
conservative changed-path escalation. The adversarial verifier
uses `--mode ac-fit`; every PASS citation must resolve at the exact recorded SHA before the fit can
be admitted.

Entering red validates the anchored Markdown plan when the acceptance-anchor profile is enabled.
A missing checker or invalid anchor prevents the transition without changing the phase.
Entering verification validates primary and chained TDD evidence: each receipt must be committed
in HEAD, unchanged in the index/worktree, and produced after the merge-base with origin/main.
Missing origin/main is unverifiable provenance and prevents verification. Commit genuine RED
receipts before advancing; whole-chain provenance is not required at green.

Verification commits review evidence, then runs one clean-HEAD L3 gate when the evidence harness is
active (L2 otherwise). Close and done-evidence reuse that receipt while the candidate is unchanged.
The close and complete transitions validate `.arbiter/gate-pass.json` before writing
the phase (L1 and L2 respectively). The marker must be valid for the current HEAD and branch and have
`tree_was_clean_at_run_time: true`; missing, corrupt, stale, or dirty-tree markers fail closed.
`ARBITER_SKIP_GATE_MARKER=1` is a local emergency bypass and is refused when `CI=true`.
