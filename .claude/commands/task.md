---
description: Full task lifecycle — plan, implement, review, gate, merge
argument-hint: '#NNN [--skip-review] [--dry-run] | --batch #N1 #N2 ... | --batch --label <labels>'
---

# /task #NNN

Full lifecycle: plan → STOP → implement → review → gate → commit → PR → merge.

**Plan Mode Required:** Must run in plan mode. If not in plan mode, STOP and tell user to enter plan mode first.

**Worktree Recommended:** Run from worktree (created via `/wt-open`). If on main or a non-task branch, STOP and suggest `/wt-open #NNN`.

---

## BATCH MODE — `/task --batch`

Invoke as:

```
/task --batch #100 #101 #102
/task --batch --label "size:XS,sprint:current"
```

Batch mode launches one isolated `Agent` per issue (clean context window each time), writes a structured report, and prints a summary table.

### Orchestration steps

1. **Resolve issues**: explicit IDs OR `gh issue list --label <labels> --state open --json number` (max 10).
2. **Create report file**:
   ```bash
   mkdir -p .evidence
   BATCH_ID="batch-$(date -u +%Y%m%d-%H%M)"
   REPORT=".evidence/${BATCH_ID}/batch-report.json"
   mkdir -p ".evidence/${BATCH_ID}"
   echo '{"batchId":"'$BATCH_ID'","started":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issues":[],"summary":{"total":0,"merged":0,"stopped":0}}' > "$REPORT"
   ```
3. **For each issue**: launch `Agent` (subagent_type: general-purpose, model: sonnet) with self-contained prompt:
   > "Execute `/task #NNN` for issue #NNN in repository `$(pwd)`. Full lifecycle: plan → implement → gate → PR → merge. Return JSON: `{ \"issue\": NNN, \"result\": \"merged|STOP\", \"phase\": \"...\", \"reviewScore\": N, \"prUrl\": \"...\", \"reason\": \"...\", \"techDebtIssues\": [] }`"
4. **After each agent returns**: append its JSON result to `batch-report.json`. STOP on one issue does NOT block subsequent issues.
5. **Print summary** on completion.

### Batch report schema

```json
{
  "batchId": "batch-20260418-1030",
  "started": "2026-04-18T10:30:00Z",
  "completed": "2026-04-18T12:15:00Z",
  "issues": [
    {
      "issue": 100,
      "result": "merged",
      "reviewScore": 84,
      "prUrl": "...",
      "techDebtIssues": []
    },
    {
      "issue": 101,
      "result": "STOP",
      "phase": "tdd",
      "reason": "gate failed: typecheck"
    }
  ],
  "summary": { "total": 2, "merged": 1, "stopped": 1 }
}
```

### Summary table format

```
═══ Batch Complete ═══
Total: 3 | Merged: 2 | Stopped: 1
#100 merged  score=84  pr=#213
#101 merged  score=91  pr=#214
#102 STOP    phase=tdd  reason=gate failed: typecheck
Report: .evidence/batch-20260418-1030/batch-report.json
```

### Constraints

- Max 10 issues per batch. Refuse if more than 10 issues resolved.
- Each agent runs with current `CLAUDE.md` + `task.md` — inherits all invariants.
- `.evidence/batch-*/` is gitignored (already in `.gitignore`).

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

### Phase 2: Classification

Classify the task:

| Tier   | Criteria                                       | Ceremony                         |
| ------ | ---------------------------------------------- | -------------------------------- |
| **XS** | Single file, <20 lines, obvious scope          | Minimal plan, 3 review agents    |
| **S**  | 2-5 files, clear scope, no schema changes      | Brief plan, 3 review agents      |
| **M**  | 5-20 files, complex logic, some schema changes | Full plan, 4 review agents       |
| **L**  | 20+ files, multiple subsystems                 | Full plan, 4+ agents, sub-agent  |
| **XL** | Cross-repo, architectural change, or >50 files | STOP — decompose into sub-issues |

Write tier to state file:

```bash
echo "<tier>" > .claude/.task-tier
```

### Phase 3: Plan Creation

Produce a plan containing:

1. **Scope**: Files to create/modify (no "etc." or "various")
2. **Test plan**: What tests to write first (TDD)
3. **Gate command**: `node scripts/check-all.mjs L2`
4. **Risk**: What could break (at least 1 item)
5. **Existing Code Survey** (CANON-16 — required for every new file under `src/`):

```markdown
## Existing Code Survey

- **Target:** `src/<relative/path>.ts`
- **Decision:** `<refactor-applied | refactor-rejected | extend | extract | new file justified | no-similar-code>`

### Evidence

- `grep "export.*<Name>" src/ --include="*.ts" -l` → `<result>`
- `grep "<keyword>" src/ --include="*.ts" -l` → `<result>`
- `ls src/<sibling>/` → `<result>`

### Rationale

<2–4 sentences: what exists, why refactor was/wasn't viable, why new file justified. ≥200 non-whitespace chars.>
```

Run `/senior-survey` to generate this block.

Write state files:

```bash
mkdir -p .git/info .claude/plans
touch .git/info/exclude
for pattern in ".claude/.task-*" ".claude/plans/" ".agents-dispatched" ".arbiter/"; do
  grep -qxF "$pattern" .git/info/exclude || printf "%s\n" "$pattern" >> .git/info/exclude
done

echo "#NNN" > .claude/.task-id
echo ".claude/plans/task-NNN.md" > .claude/.task-plan
echo "plan" > .claude/.task-phase
mkdir -p .claude/.task-NNN
echo '{"phase":"plan","task":"#NNN","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .claude/.task-NNN/status.json
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) plan" >> .claude/.task-NNN/log.md
```

**Size routing before STOP:**

| Tier   | Action                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| XS/S/M | Proceed normally — STOP and await GO                                                                             |
| L      | Dispatch sub-agent with full context brief: issue body, invariants, plan, file list. Do not edit files yourself. |
| XL     | HARD STOP — do not edit any file. Decompose into ≤5 sub-issues and present list to user.                         |

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
   echo "implementation" > .claude/.task-phase
   echo '{"phase":"implementation","task":"#NNN","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .claude/.task-NNN/status.json
   echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) implementation" >> .claude/.task-NNN/log.md
   ```

### Phase 5: Implementation (TDD)

- Use TDD: write test first, then implementation (Red → Green → Refactor)
- Run gate after each logical unit:
  ```bash
  node scripts/check-all.mjs L1
  ```
- Keep commits atomic: one logical change per commit
- Commit format: `type(#NNN): summary`

**Checkpoint every 3 commits (mandatory):**

```bash
node scripts/check-all.mjs L1
git diff origin/main --name-only | head -20
```

Scan diff for:

- Any `any` type usage → fix immediately
- Secrets or PII patterns → HARD STOP, remove before proceeding

**Tech-debt detection:** If you discover a genuine debt item (not in scope of current task), do NOT fix it inline. Create a tracking issue:

```bash
gh issue create --label "tech-debt" --title "TD: <description>" --body "<context from current work>"
```

Then continue with current task without the inline fix.

### Phase 6: Code Review (MANDATORY)

**Agent minimums:**

| Tier | Minimum agents        |
| ---- | --------------------- |
| XS   | 3                     |
| S    | 3                     |
| M    | 4                     |
| L    | 4                     |
| XL   | N/A (decompose first) |

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

#### 6.5 — Score-based verdict (0–100)

Score the implementation across four dimensions (0–25 each):

| Dimension         | 0 (fail)             | 25 (full)                        |
| ----------------- | -------------------- | -------------------------------- |
| Correctness       | Logic bugs found     | No bugs found                    |
| Test quality      | Happy path only      | Edge cases + error paths covered |
| Domain compliance | Invariant violation  | All invariants satisfied         |
| Silent failures   | Swallowed exceptions | All errors surfaced              |

**Verdict:**

| Score | Verdict | Action                            |
| ----- | ------- | --------------------------------- |
| ≥ 80  | PASS    | Proceed to Phase 7                |
| 60–79 | REWORK  | Fix findings, re-run agents       |
| < 60  | STOP    | Do not proceed — escalate to user |

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
node scripts/check-all.mjs L2
```

Gate must be **GREEN**. If it fails:

- Fix root cause. No `--no-verify`. No skipping.
- Report blocker if fails after two focused attempts.

Update phase:

```bash
echo "verification" > .claude/.task-phase
echo '{"phase":"verification","task":"#NNN","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .claude/.task-NNN/status.json
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) verification" >> .claude/.task-NNN/log.md
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
gh issue close NNN
echo "complete" > .claude/.task-phase
echo '{"phase":"complete","task":"#NNN","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .claude/.task-NNN/status.json
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) complete" >> .claude/.task-NNN/log.md
```

If using worktree, close it:

```bash
/wt-close NNN
```

### Phase C1: Post-Merge Review (after ≥3 tasks merged in one session/batch)

When ≥3 tasks merge in the same batch or sprint window, create a post-merge review document:

```bash
DATE=$(date -u +%Y-%m-%d)
mkdir -p docs/testing
# Fill template if it exists, otherwise create from scratch
TEMPLATE="docs/testing/POST_MERGE_REVIEW_TEMPLATE.md"
TARGET="docs/testing/POST_MERGE_REVIEW_${DATE}.md"
if [ -f "$TEMPLATE" ]; then
  cp "$TEMPLATE" "$TARGET"
fi
```

**Required sections** (use `docs/testing/POST_MERGE_REVIEW_TEMPLATE.md` if present):

- Scope: which task IDs merged, number of commits
- Summary table: task ID, scope, review score, verdict
- Bundle details: findings per task, known limitations
- Finding classification (P1–P5 / PASS/CONCERNS/FAIL)

**Verdict thresholds:** PASS ≥75 | CONCERNS 60–74 | FAIL <60. Security findings weighted 2×.

Commit the document: `docs(batch): post-merge review YYYY-MM-DD`

## Gate Failure

If gate fails: fix root cause. No `--no-verify`. No skipping.
Report blocker if fails after two focused attempts.
