---
scenario: ship-one-xs-issue
sha: 72a7d3c0426cecaf6913a87f9b453556ea6fb3fd
date: 2026-08-30
persona: Solo maintainer with one small well-specified issue and thirty minutes to land it
steps: 7
findings:
  blocker: 0
  major: 5
  minor: 2
---

# Tabletop — ship-one-xs-issue

I have one XS issue and half an hour. I read `/ship`'s command doc to learn the phases, the
ship-driver reference to learn what drives them, and the state-file reference to learn what
`/ship` writes down. The command doc's "Phase map" section opens with eighty lines about
review-agent tiering before the actual table shows up; the ship-driver reference warns me
that a command it depends on was deleted and never replaced — a warning a test in this repo
proves is out of date; and the state-file reference turns out to document a different file
than the one `/ship` uses. Then I ask the CLI where I am. It answers `preflight`. I have no
task. The phase it reported belongs to somebody else's branch.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 5 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:76 — the scenario's starting state is "A clean checkout on `main`, an open XS issue, **no active task state**" | on branch `task/#2429-tabletop-runs` with no task of my own, `node dist/cli.js task get --field phase` printed `preflight` and exited 0. `.claude/.task/status.json` holds `"taskId": "#2351"`, `"branch": "fix/2351-prepare-tolerant-git-config"` — state from an unrelated, long-finished task. `task get` neither compares the recorded branch to the checked-out one nor warns that the state is foreign, so a maintainer starting fresh is told their task is already seeded | major | bug | `__tests__/commands/task-get.test.ts`: when `status.json`'s `branch` differs from `git rev-parse --abbrev-ref HEAD`, `task get` must exit non-zero or print a staleness warning rather than returning the foreign phase silently | #2435 |
| 4 | .claude/commands/ship.md:215-223 — the phase-map table enumerates the phases `/ship` drives: preflight, plan, red-team-review, red, green, refactor, verification, complete | `node dist/cli.js task advance --help` accepts ten target phases: `preflight`, `plan`, `red-team-review`, `red`, `green`, `refactor`, `verification`, `close`, `complete`, `red-team-rework`. `close` appears nowhere in `.claude/commands/ship.md` (grep returns no hit), yet it is the phase with the mandatory gate-pass-marker gate at `src/commands/task.ts:634` and the phase `.claude/rules/95-closer-mode.md` names as CLOSER-mode's trigger. The scenario's exit criterion — "no phase is reachable by a command the docs do not name" — fails on `close` | major | doc-drift | `__tests__/docs/ship-phase-map.test.ts`: assert the set of phases in the `--to` choices of `arbiter task advance` equals the set of phase rows in `.claude/commands/ship.md`'s phase-map table | #2435 |
| 4 | .claude/commands/ship.md:221 — the `red-team-review` row promises "Dispatch tier-N red-team agents"; :223 — the `refactor` row promises "dispatch 1 independent code-review agent ... + 1 adversarial verifier" | `src/commands/task.ts:621-644` defines phase gates for only five of the ten phases: `red`, `green`, `verification`, `close`, `complete`. Advancing into or out of `preflight`, `plan`, `red-team-review`, `refactor` and `red-team-rework` asserts nothing at all, so `arbiter task advance --to verification` succeeds with no review ever dispatched. The two checks that would notice — `check-review-completion.mjs` and `check-refutation-verdicts.mjs` — are registered in the emitted gate registry at level L2 with kind `warn`, so they cannot fail a build either. The scenario's exit criterion "every phase ... maps to a real subcommand and a real gate" fails for five phases | major | missing-gate | `__tests__/commands/task-advance-gates.test.ts`: every phase whose ship.md row promises a dispatch or an artifact must have an entry in the `phaseGates` record; and promote `review-completion` from `warn` to `check` in the gate registry | #2435 |
| 2 | docs/REFERENCE/ship-driver.md:37-40 — "**Known gap:** the template text still instructs the driver to invoke \"arbiter ship-on-red\", a command removed in the T2 command-surface cut ... the driver must apply the policy manually until this is reconciled" | the gap was closed and the warning was not retracted. `grep -rn ship-on-red src/templates/` returns nothing; `__tests__/templates/ship-driver-render.test.ts:130` regression-locks `expect(md).not.toContain('arbiter ship-on-red')` under the comment "ship-on-red was retired". The same stale premise drives ship-driver.md:53-56 ("with the engine removed ... the driver is currently the only thing left that could read or write it"). `src/generators/ship-driver.ts:5` also still names the dead verb in a comment. Confirmed dead: `node dist/cli.js ship-on-red` exits 1 with "error: unknown command 'ship-on-red'" | major | doc-drift | `scripts/check-phantom-command-scan.mjs`: extend the scan to quoted (non-backticked) `arbiter <verb>` mentions in docs/REFERENCE, so a doc naming a verb absent from `src/cli.ts` fails whether or not the mention sits in backticks | #2433 |
| 6 | .claude/commands/ship.md:222 — the `red` phase row instructs "Write failing tests with the `tdd` skill (red → verify-red is its own step)" | `.claude/skills/tdd/SKILL.md` never names `arbiter task record-red`. It documents a five-step Red-Green-Refactor loop and a `npm run test` command, and stops. But `src/commands/task.ts:628` gates the advance into `green` on `checkTddEvidenceGate`, whose evidence file only `arbiter task record-red` writes — a command named in README.md:83 and in `arbiter task --help`, but not in the skill the phase table routes the user to. Following the skill exactly leaves the next phase gate red | major | doc-drift | `__tests__/docs/skill-gate-coupling.test.ts`: for each phase gate in `src/commands/task.ts`, assert the skill named by that phase's ship.md row mentions the command that produces the evidence the gate reads | #2435 |
| 3 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:80 — the docs this persona reads include "docs/REFERENCE/state-file.md", for a journey about `/ship` task state | `docs/REFERENCE/state-file.md:12` documents `.arbiter-generated.json`, the generator snapshot `arbiter update` reads for drift detection. The state `/ship` actually writes and `task get` actually reads is `.claude/.task/status.json`, whose schema no file under `docs/REFERENCE/` documents — it is only mentioned in passing by `docs/REFERENCE/task-recovery.md`. A maintainer following the catalogue reads the wrong contract | minor | doc-drift | add the `.claude/.task/status.json` schema to `docs/REFERENCE/state-file.md` (or a sibling) and list it in `scripts/check-ssot-core.mjs`'s core doc set | #2433 |
| 1 | .claude/commands/ship.md:133 — the section heading "## Phase map" | the section named "Phase map" opens with review-agent tier calibration and the cross-model review seat; the actual phase table does not appear until line 215, eighty-two lines below its own heading. A maintainer jumping to the named section to learn the phases finds a discussion of reviewer counts instead | minor | ux | `scripts/check-claude-md-lint.mjs`: require the first table under a `## Phase map` heading to appear within N lines of it | #2433 |

## Appendix — verbatim probe output

Pinned tree: `72a7d3c0426cecaf6913a87f9b453556ea6fb3fd`, branch `task/#2429-tabletop-runs`.

`node dist/cli.js task --help` (step 4) — the real subcommand surface:

```
Commands:
  resume [options]            Print recovery instructions for the current task phase
  advance [options]           Advance (or reverse) the task lifecycle phase
  recover [options]           Print 3-layer recovery context for the current task (#694)
  record-red [options]        Record TDD red-phase evidence: run a failing test and capture evidence (#551)
  record-tech-debt [options]  File a tech-debt GitHub issue and persist evidence (#702)
  init [options]              Initialise / update the unified task document (#1206)
  get [options]               Print a single task-state field for shell consumers (#1206)
```

`node dist/cli.js task advance --help` (step 4) — the ten reachable phases:

```
  --to <phase>        Target phase
                      (preflight, plan, red-team-review, red, green, refactor,
                       verification, close, complete, red-team-rework)
```

`node dist/cli.js task get --field phase` (step 5), on a branch with no task of mine:

```
preflight
```

…backed by `.claude/.task/status.json`:

```
{
  "taskId": "#2351",
  "phase": "preflight",
  "tier": "XS",
  "branch": "fix/2351-prepare-tolerant-git-config"
}
```

The phase-gate map at `src/commands/task.ts:621-644` (step 4) — five of ten phases gated:

```
  const phaseGates: Partial<Record<TaskPhase, () => void>> = {
    red: ...checkPlanReviewGate / checkHandoffGate
    green: ...checkTddEvidenceGate
    verification: ...checkChainTddEvidenceGate
    close: ...checkGatePassMarkerGate(dir, 'L1')
    complete: ...checkGatePassMarkerGate + checkPrMergedGate
  }
```

`node dist/cli.js ship-on-red` (step 2):

```
error: unknown command 'ship-on-red'
```

`node scripts/check-tdd-evidence.mjs` on this branch (step 7):

```
check-tdd-evidence: no commits since merge-base, vacuous pass
```
