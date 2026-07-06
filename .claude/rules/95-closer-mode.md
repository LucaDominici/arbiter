# CLOSER Mode (A11)

Empirical failure mode across multiple AI-driven repos (2026-07): agents burn hours
_discovering_ work (spawning tech-debt issues, refactoring adjacent code) instead of
_closing_ it — discovery is cheap and visible, the residual 10% (merge, red gate,
conflict) is hard. This rule fixes the mode, not the hope.

**Trigger:** the task enters its closing phase (post-implementation, pre-merge —
`arbiter task advance --to close`), or a human invokes it on stuck work.

## The 7 rules

1. **Single named target.** No switching to a different file/bug/issue mid-close.
2. **No discovery.** Opening new issues, or refactoring beyond the minimal diff, is
   FORBIDDEN. Findings go on a PARKING list — one line, no action. This includes
   deleting a colleague's untracked file to make a format/lint check pass — report the
   obstruction instead of removing the evidence.
3. **Discovery is the failure mode.** Closing is the only success metric while this
   rule is active.
4. **Two strikes.** The same error surviving 2 fix attempts requires a 5-line
   root-cause writeup before a 3rd attempt, or the item is declared BLOCKED and the
   agent moves to the next one.
5. **Pre-existing failures are the blocker.** A red gate or failing check on the branch
   is this task's responsibility, not an excuse to skip it.
6. **Done = merged + evidence.** A completion claim is never made from a green local
   run alone — it requires the PR merged (or gate green with a recorded evidence
   artifact) on the current tree.
7. **Never end on a promise.** Foreground-wait on PR/gate checks (e.g.
   `gh pr checks <n> --watch`) — a background "monitor" cannot actually wake a stalled
   agent. End the turn on the report, not on "I'll check back."

**PARKING list convention:** append findings to `.arbiter/findings/<task-id>.jsonl`
(one line per finding, no code changes) rather than opening an issue or fixing them
inline — see `arbiter note`.
