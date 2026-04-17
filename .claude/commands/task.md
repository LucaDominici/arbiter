# /task #NNN

Full task lifecycle: branch, plan, implement, gate, commit, PR, merge.

## Phase 0 — Preflight (MANDATORY)

1. **Branch guard**: Run `git branch --show-current`
   - If on `main` → HARD STOP — create task branch first, do not proceed
2. **Duplicate-branch guard**: Run `git branch --list "task/#NNN-*"`
   - If a matching branch already exists → confirm with user before switching or re-creating
3. Read the GitHub issue: `gh issue view NNN`
   - Confirm issue is OPEN before starting; if closed, alert user
4. **Extract acceptance criteria**: List every exit criterion / AC from the issue body explicitly

## Phase 1 — Setup

1. Read `AGENTS.md` — internalize invariants before touching any code
2. Create branch: `git checkout -b task/#NNN-kebab-case-description`
3. Check for existing plan: `ls ~/.claude/plans/ | grep -i NNN`
   - If a plan exists, read it — do not re-plan from scratch
4. Identify files to change (3+ files → create a plan and confirm with user)

## Phase 2 — Acceptance Criteria Gate

List the acceptance criteria extracted in Phase 0. Confirm with user they are complete.

**STOP HERE** — await user GO before editing any file

## After GO

- Use TDD: write the test first, then the implementation
- Run `node scripts/check-all.mjs L1` after each logical unit
- Keep commits atomic: one logical change per commit

## Phase 3 — Code Review (MANDATORY before gate)

**Task complexity:**

- XS/S (< 3 files, < 50 changed lines): 3 agents minimum
- Standard (≥ 3 files or ≥ 50 lines): 4 agents minimum

### Phase 3.1 — Dispatch parallel review agents (run ALL simultaneously)

- **Agent 1 — Bugs & logic errors**: Null/undefined mishandling, incorrect conditions, wrong defaults, off-by-one errors
- **Agent 2 — Type safety & patterns**: Unsafe casts, `any` leaks, missing type guards, SOLID violations
- **Agent 3 — Domain consistency**: Do changes respect invariants (AGENTS.md), ADRs, and governance contracts?

### Phase 3.2 — Silent failure hunter (always runs, separate agent)

Hunt specifically for: swallowed exceptions (`catch {}`), `??` defaults that mask undefined with wrong fallbacks, conditions that silently produce no output, unhandled promise rejections.

### Phase 3.3 — Agent dispatch gate

HARD STOP if agents were not dispatched. "I reviewed it" without actual agent tool calls does not satisfy this gate.

### Phase 3.5 — Acceptance criteria verification (MANDATORY)

Re-read the original GitHub issue. For each acceptance criterion, state: PASS / FAIL / NOT TESTED.
If any FAIL → fix before proceeding.

## Phase 4 — Gate + Commit

1. Run `node scripts/check-all.mjs L2` — must be GREEN
2. Commit with convention: `type(#NNN): summary`
3. Push branch: `git push -u origin HEAD`

## Phase 4.5 — Post-Commit Verifier Agent (MANDATORY, before PR)

Dispatch a single adversarial verifier agent against the committed code. This agent runs AFTER the gate passes but BEFORE the PR is created, so any findings can be fixed in the same PR.

The verifier agent must:

- Trace each new feature end-to-end (generator emits file → template imports correct path → runtime behavior is correct)
- Check for dead code / defined-but-never-used fields (especially in MetricsProfile-style computed configs)
- Verify --update / ratchet logic preserves prior state (no silent metric drops)
- Check CLI option wiring end-to-end (flag declared → parsed → forwarded → guarded)
- Verify fixture execute bits and test setup assumptions

**Agent dispatch gate**: HARD STOP if verifier agent was not dispatched. Treat any [ISSUE] finding as a blocker — fix, re-gate, re-commit before proceeding to Phase 5.

## Phase 5 — PR + Merge

4. Create PR: `gh pr create --title "type(#NNN): summary" --body "..."`
5. Verify CI passes: `gh pr checks`
6. Merge when green: `gh pr merge --squash`
7. Close issue: `gh issue close NNN`

## Gate Failure

If gate fails: fix root cause. No `--no-verify`. No skipping.
Report blocker if fails after two focused attempts.
