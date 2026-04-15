# /complete-task

Finalize a task: gate, commit, PR, merge.

## Phase 0 — Preflight

1. Verify not on `main`: `git branch --show-current` — if on `main`, HARD STOP
2. Extract issue number from branch name (e.g., `task/#82-...` → `#82`)

## Phase 1 — Code Review (MANDATORY before gate)

**Task complexity:**

- XS/S (< 3 files, < 50 changed lines): 3 agents minimum
- Standard (≥ 3 files or ≥ 50 lines): 4 agents minimum

### Phase 1.3 — Dispatch parallel review agents (run ALL simultaneously)

- **Agent 1 — Bugs & logic errors**: Null/undefined mishandling, incorrect conditions, wrong defaults, off-by-one errors
- **Agent 2 — Type safety & patterns**: Unsafe casts, `any` leaks, missing type guards, SOLID violations
- **Agent 3 — Domain consistency**: Do changes respect invariants (AGENTS.md), ADRs, and governance contracts?

### Phase 1.3.2 — Silent failure hunter (always runs, separate agent)

Hunt specifically for: swallowed exceptions (`catch {}`), `??` defaults that mask undefined with wrong fallbacks, conditions that silently produce no output, unhandled promise rejections.

### Phase 1.3.9 — Agent dispatch gate

HARD STOP if agents were not dispatched. "I reviewed it" without actual agent tool calls does not satisfy this gate.

### Phase 1.5 — Acceptance criteria verification (MANDATORY)

Re-read the original GitHub issue. For each acceptance criterion, state: PASS / FAIL / NOT TESTED.
If any FAIL → fix before proceeding.

## Phase 2 — Gate + Commit

1. Run `node scripts/check-all.mjs L2` — must be GREEN
2. Commit with convention: `type(#NNN): summary`
3. Push branch: `git push -u origin HEAD`

## Phase 3 — PR + Merge

4. Create PR: `gh pr create --title "type(#NNN): summary" --body "..."`
5. Verify CI passes: `gh pr checks`
6. Merge when green: `gh pr merge --squash`
7. Close issue: `gh issue close NNN`

## Gate Failure

If gate fails: fix root cause. No `--no-verify`. No skipping.
Report blocker if fails after two focused attempts.
