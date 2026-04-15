# /start-task #NNN

Initialize a task properly.

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

5. **STOP HERE** — await user GO before editing any file

## After GO

- Use TDD: write the test first, then the implementation
- Run `node scripts/check-all.mjs L1` after each logical unit
- Keep commits atomic: one logical change per commit
- When done: run `/complete-task` (includes mandatory verifier agents)
