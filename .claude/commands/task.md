---
description: Full task lifecycle — plan, implement, review, gate, merge
argument-hint: '#NNN [--skip-review] [--dry-run]'
---

# /task #NNN

Full lifecycle: plan → STOP → implement → review → gate → commit → PR → merge.

**Plan Mode Required:** Must run in plan mode. If not in plan mode, STOP and tell user to enter plan mode first.

**Worktree Recommended:** Run from worktree (created via `/wt-open`). If on main or a non-task branch, STOP and suggest `/wt-open #NNN`.

---

## PHASE PLAN — Read-Only

### Phase 0: Preflight

1. **Branch guard**:

   ```bash
   git branch --show-current
   ```

   | Branch                      | Action                                     |
   | --------------------------- | ------------------------------------------ |
   | `main` or `master`          | HARD STOP — create task branch or worktree |
   | does not start with `task/` | STOP — create proper branch                |

2. **Worktree check**: If not in a worktree, suggest `/wt-open #NNN` for isolation.

3. **Read issue**:

   ```bash
   gh issue view NNN
   ```

   Confirm issue is OPEN. If closed, warn user.

4. **Duplicate guard**: Check for existing branch:

   ```bash
   git branch --list "task/#NNN-*"
   ```

   If exists, confirm before reusing or recreating.

5. **Flag parsing**: Check for `--skip-review` and `--dry-run` flags in the command arguments.

### Phase 1: Context

1. Read `AGENTS.md` — internalize invariants.

2. Read `docs/SYSTEM/CANON.md` — internalize process rules.

3. Check for existing plan: `ls .claude/plans/ | grep -i NNN`
4. Identify scope: which files need to change?

5. For Standard-tier tasks: `mkdir -p ".evidence/#NNN" && cp .evidence/BACKLOG.md.template ".evidence/#NNN/BACKLOG.md"`

### Phase 2: Classification

Classify the task into one of three tiers. Each tier sets the **plan depth**
and the **minimum number of parallel code-review agents** to dispatch in
Phase 6 below.

### Tier XS

- **Criteria:** Single file, obvious scope.
- **Plan depth:** minimal
- **Review agents:** 3 review agents minimum.

### Tier S

- **Criteria:** 2–5 files, clear scope.
- **Plan depth:** brief
- **Review agents:** 3 review agents minimum.

### Tier Standard

- **Criteria:** Multi-file, complex logic, schema changes.
- **Plan depth:** full
- **Review agents:** 4 review agents minimum.

Write the selected tier to the state file:

```bash
echo "<tier>" > .claude/.task-tier
```

### Phase 2.7: Red-Team Review (Pre-Plan Adversarial Review)

Advance phase before dispatching agents:

```bash
arbiter task advance --to red-team-review
```

Dispatch **N parallel red-team agents** based on tier (XS=1, S=2, Standard=3). Each agent self-selects an attack angle from: `security`, `concurrency`, `performance`, `edge-cases`, `regression`, `dependency`, `data-integrity`, `error-handling`.

Agents write findings to `.arbiter/evidence/redteam/<task-id>.json` using the `RedTeamEvidenceV1` schema.

**Routing by finding impact:**

| Impact        | Action                                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| CRITICAL      | `arbiter task advance --to red-team-rework` → revise plan → re-run Phase 2.7 |
| HIGH / MEDIUM | Adapt plan in-place before advancing                                         |
| SUGGESTION    | Note only — no blocking                                                      |

Once all findings are CLEAR or resolved:

```bash
arbiter task advance --to implementation
```

### Phase 3: Plan Creation

Every plan MUST begin with a YAML front-matter **Context Block** (see `docs/REFERENCE/plan-template.md`). Copy the template below and fill in each field before writing the plan body:

```markdown
---
context:
  issue: '#NNN' # or: issues: ["#NNN", "#MMM"]
  type: feat # feat | fix | docs | chore | refactor
  pipeline: 'plan → impl → gate → PR'
  branch_convention: 'task/#NNN-kebab-description'
  base_branch: main
  key_constraints:
    - 'Constraint 1'
  red_team_warnings:
    - 'Warning 1'
  estimate: 'S (2h)' # S|M|L with rough hours
---
```

Produce a plan containing:

1. **Scope**: Files to create/modify (no "etc." or "various")
2. **Test plan**: What tests to write first (TDD)
3. **Gate command**: `npm run test`
4. **Risk**: What could break (at least 1 item)

Ensure runtime state stays local-only before writing task state:

```bash
mkdir -p .git/info .claude/plans
touch .git/info/exclude
for pattern in ".claude/.task-*" ".claude/plans/" ".agents-dispatched" ".arbiter/"; do
  grep -qxF "$pattern" .git/info/exclude || printf "%s\n" "$pattern" >> .git/info/exclude
done
```

Write state files:

```bash
echo "#NNN" > .claude/.task-id
echo ".claude/plans/task-NNN.md" > .claude/.task-plan
arbiter task advance --to plan
```

**STOP HERE** — await user GO before editing any file.

---

## PHASE EXEC — After GO

### Phase 4: Setup

1. **Dirty-tree guard**: Working tree must be clean before starting.

   ```bash
   git status --porcelain
   ```

   If dirty, STOP and commit/stash changes first.

2. **Create branch** if not already on one:

   ```bash
   git checkout -b task/#NNN-kebab-case-description
   ```

3. **Update phase**:
   ```bash
   arbiter task advance --to implementation
   ```

### Phase 5: Implementation (TDD)

- Use TDD: write test first, then implementation (Red → Green → Refactor)

- Run gate after each logical unit:
  ```bash
  npm run test
  ```
- Keep commits atomic: one logical change per commit
- Commit format: `type(#NNN): summary`

#### Filing tech-debt during implementation

When you discover a pre-existing violation in code you are NOT changing (ADR violation in untouched code, missing enforcement, fragile abstraction that would require out-of-scope rework), file a tech-debt issue rather than scope-creeping the current task.

**Background:** Reviewers and auditors need a traceable record of known gaps so they are not silently dropped.

**Finding trigger conditions:**

- Pre-existing INV violation in code not touched by this task
- Missing script enforcement for a documented invariant
- Fragile abstraction that requires a separate design decision before fixing

**Risk:** Untracked tech-debt accumulates silently and resurfaces as regressions.

**Remediation:** Invoke `arbiter task record-tech-debt`:

```bash
arbiter task record-tech-debt \
  --description "brief finding description" \
  --triggered-by "#NNN"   # defaults to .claude/.task-id if omitted
```

The subcommand creates a GitHub issue labeled `tech-debt` + `follow-up` and appends the issue number to `.arbiter/evidence/<task-id>/tech-debt.json`. Failure is soft (exit 0); reason is emitted to stderr so the current task is not blocked.

### Phase 6: Code Review (MANDATORY)

**Agent minimums (from `taskTiers` config):**

- XS: 3 agents minimum
- S: 3 agents minimum
- Standard: 4 agents minimum

#### 6.1 — Dispatch parallel review agents (run ALL simultaneously)

- **Agent 1 — Bugs & logic errors**: Null/undefined mishandling, incorrect conditions, wrong defaults, off-by-one errors
- **Agent 2 — Type safety & patterns**: Unsafe casts, `any` leaks, missing type guards, SOLID violations
- **Agent 3 — Domain consistency**: Do changes respect invariants (AGENTS.md), ADRs, and governance contracts?
- **Agent 4 — (Standard only) Test quality**: Are tests meaningful? Edge cases covered? Not just happy path?

#### 6.2 — Silent failure hunter (always runs, separate agent)

Hunt specifically for: swallowed exceptions (`catch {}`), `??` defaults that mask undefined with wrong fallbacks, conditions that silently produce no output, unhandled promise rejections.

#### 6.3 — File-backed dispatch gate

After dispatching agents, record the count:

```bash
echo "3" > .agents-dispatched   # or 4 for Standard
```

**HARD STOP** if agents were not actually dispatched. "I reviewed it" without agent tool calls does not satisfy this gate.

#### 6.4 — Acceptance criteria verification

Re-read the original GitHub issue. For each acceptance criterion, state: PASS / FAIL / NOT TESTED. If any FAIL, fix before proceeding.

### Phase 7: Adversarial Verifier (MANDATORY)

Dispatch a single adversarial verifier agent. This runs AFTER code review but BEFORE the gate.

The verifier must:

- Trace each new feature end-to-end
- Check for dead code / defined-but-never-used fields
- Verify CLI option wiring end-to-end (flag declared → parsed → forwarded)
- Check fixture assumptions and test setup

**HARD STOP** if verifier agent was not dispatched. Treat [ISSUE] findings as blockers.

### Phase 8: Gate

```bash
npm run test
```

Gate must be **GREEN**. If it fails:

- Fix root cause. No `--no-verify`. No skipping.
- Report blocker if fails after two focused attempts.

Update phase:

```bash
arbiter task advance --to verification
```

### Phase 9: Commit + Push

```bash
git add <specific-files>
git commit -m "type(#NNN): summary"
git push -u origin HEAD
```

### Phase 10: PR + Merge

```bash
gh pr create --title "type(#NNN): summary" --body "Fixes #NNN"
gh pr checks
gh pr merge --squash
```

### Phase 11: Cleanup

```bash
node scripts/done-evidence.mjs

gh issue close NNN

arbiter task advance --to complete
```

If using worktree, close it:

```bash
/wt-close NNN
```

## Gate Failure

If gate fails: fix root cause. No `--no-verify`. No skipping.
Report blocker if fails after two focused attempts.
