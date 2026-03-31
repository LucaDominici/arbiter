# /start-task #NNN

Initialize a task properly.

## Steps

1. Read the GitHub issue: `gh issue view NNN`
2. Read `AGENTS.md` — internalize invariants
3. Create branch: `git checkout -b task/#NNN-short-description`
4. Identify files to change (3+ files → create a plan first)
5. **STOP HERE** — await user GO before editing

## After GO

- Use TDD: write test first, then implementation
- Run `./scripts/check-all.sh L1` after each logical unit
- Keep commits atomic: one logical change per commit
