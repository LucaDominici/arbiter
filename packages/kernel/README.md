# Completion-Integrity Kernel

A Claude Code plugin that makes an AI coding agent's "task complete" claim
**fail-closed**: the agent cannot declare a task done without machine-verified,
SHA-pinned, anti-replay evidence that a real gate ran on the real tree. Linters,
git hooks, and CI cannot give this guarantee — they fire _after_ the agent has
already claimed done, or are trivially skipped with `--no-verify`.

## What it blocks

Every row below is a real error mode an agent can produce; every result was
observed running the emitted hooks in a clean sandbox repo with the exact
Claude Code hook protocol (stdin JSON, exit code semantics).

| #   | Seeded agent error                                                          | This kernel                                                                                                                            | pre-commit / husky                                 | secret scanner                                       | linter (default rules)                         |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| 1   | Declares "task complete" **without having run the gate**                    | **EXIT 2** — plan-review/gate evidence missing                                                                                         | no signal (git has no "agent declares done" event) | n/a                                                  | n/a                                            |
| 2   | **Fabricates** the gate-pass/plan-review evidence file with an invented SHA | **EXIT 2** — SHA is not an ancestor of HEAD (stale)                                                                                    | no                                                 | no                                                   | no                                             |
| 3   | Gate ran on an OLD tree, more edits happened, then "done"                   | **EXIT 2** — head SHA ≠ current HEAD, re-run required                                                                                  | no                                                 | no                                                   | no                                             |
| 4   | Green path: gate genuinely ran on exact HEAD                                | **EXIT 0** — claim allowed                                                                                                             | —                                                  | —                                                    | —                                              |
| 5   | Silences a failing test with a skip directive                               | **EXIT 2** at edit-time, agent sees the reason                                                                                         | only via a custom plugin, and only at commit-time  | no                                                   | passes clean                                   |
| 6   | Hardcodes PII (email + phone) in source                                     | **EXIT 2** at edit-time                                                                                                                | no                                                 | secret scanners look for _secrets_, not PII — no hit | passes clean                                   |
| 7   | Runs `git commit --no-verify` to skip the local hook                        | commit succeeds (as everywhere)… but the completion guard still catches it at the Stop boundary: **EXIT 2** (gate-pass SHA ≠ new HEAD) | bypassed by design (the hook never ran)            | n/a                                                  | n/a                                            |
| 8   | Edits in the implementation phase with no anchored plan                     | **EXIT 2** — no plan artifact bound to this session                                                                                    | no                                                 | no                                                   | no                                             |
| 9   | Emits a new gate script that is never wired into the runner                 | surfaced by name (scaffold-not-wired detection)                                                                                        | no standard tool names this defect class           | no                                                   | no (orphan-export tools ≠ orphan-_gate_ tools) |

The delta is stark: one column is a wall of `EXIT 2`; the others are silence.
The decisive chain is #7 → #3: even bypassing every git hook, the agent cannot
exit the task without re-running the gate on the _actual_ tree.

## Anti-erosion (T1)

A packaged guardrail that a user can silently defeat is worse than no
guardrail — it _looks_ active while doing nothing. This kernel's source
project (arbiter) ships an anti-erosion pair specifically for this failure
mode:

- **`arbiter update` adopts safety-class hook fixes by default.** A hook file
  that a user has hand-modified would normally be "frozen" forever (the
  general template-preservation contract) — except for files under
  `.claude/hooks/*.mjs`, which are safety-class and get the shipped fix
  written over the modification, with the prior content preserved verbatim in
  `.arbiter/evidence/local-overrides/` (reversible, not a silent discard).
- **A ratchet gate (`check-safety-adopt-ratchet.mjs`) fails the build** if a
  safety-class file is still withheld (user modified it AND adoption was
  explicitly disabled). Erosion becomes a visible, blocking gate — not a
  silent "skipped".

This is why the hooks in this plugin can be trusted to match what's described
above: the mechanism that would otherwise let them go stale in silence is
itself gated.

## Known limits (stated, not hidden)

- The Stop-hook's completion-claim detector is a heuristic scan of the
  transcript for completion phrasing — creative paraphrasing can evade
  detection. It is anti-carelessness, not anti-adversary.
- Any bypass/override env var for the completion gate must be set outside the
  agent's own reach (human/CI environment, never a flag the agent can set on
  itself) and is logged append-only, non-repudiable. See the source project's
  emitted `.claude/settings.json` `permissions.deny` list for the concrete
  denial surface.
- The harness's own permission system, not this hook set, is the backstop
  against an agent editing `.claude/settings.json` itself.

## Install

Copy `hooks/` into your project and point Claude Code's hook settings at it
(or install via the Claude Code plugin marketplace once published — see
`.claude-plugin/plugin.json`). Hooks are dependency-free vanilla `.mjs` — no
runtime, no build step, no arbiter CLI required to run them.

## Contents

| File                         | Event                     | Role                                                          |
| ---------------------------- | ------------------------- | ------------------------------------------------------------- |
| `lib.mjs`                    | —                         | shared helpers (repo root, task-state read, sanitization)     |
| `stop-evidence-guard.mjs`    | `Stop`                    | the completion-integrity backstop (#1–4 above)                |
| `guard-done-evidence.mjs`    | `UserPromptSubmit`        | completion-claim detection + SHA-256 pinned-file verification |
| `stop-dangerous.mjs`         | `PreToolUse:Bash`         | blocks destructive commands (`rm -rf /`, force-push, etc.)    |
| `enforce-gate-before-pr.mjs` | `PreToolUse:Bash`         | blocks a PR/merge command until the gate marker is present    |
| `enforce-read-only.mjs`      | `PreToolUse:Edit\|Write`  | blocks edits to declared read-only paths                      |
| `pre-edit-ssot-guard.mjs`    | `PreToolUse:Edit\|Write`  | blocks edits to source-of-truth docs without approval         |
| `check-no-orphan-todo.mjs`   | `PostToolUse:Edit\|Write` | blocks a bare `TODO` with no tracked issue reference          |
| `check-no-placeholders.mjs`  | `PostToolUse:Edit\|Write` | blocks stub/placeholder content masquerading as done          |

Rebuilt from the source project's own emitted templates via
`node scripts/build-kernel-plugin.mjs` (run after `npm run build`) — so this
plugin can never silently drift from what the CLI ships into governed repos.

## Status

**Structure + manifest, not yet marketplace-published.** What's landed:
hooks rendered/copied from the canonical source, `hooks.json` wiring,
this README. What remains (see the parent task's report): a live
Claude-Code-plugin-loader compatibility check, the two `doctor` detectors
(scaffold-wiring, emission-coherence) as a standalone companion, and the full
stdin-JSON red/green demo reproduced from inside an _installed_ plugin rather
than the hook files run directly.
