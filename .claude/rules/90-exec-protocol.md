# Execution Protocol

## Branch Enforcement (MANDATORY)

Before any file edit:

1. Run `git branch --show-current`
2. If on `main` → HARD STOP → create task branch
3. Branch must start with `task/` — e.g., `task/#123-description`

## Execution Flow

1. Read AGENTS.md (invariants + governance)
2. Create task branch if not on one
3. Plan before editing (3+ file changes → outline first)
4. Run `/start-task #NNN` to initialize properly
5. Implement with TDD (test first)
6. Run `node scripts/check-all.mjs L1` before commit
7. Run `node scripts/check-all.mjs L2` before push
8. Run `/complete-task` to create PR

## Gate Commands

```bash
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```

CI Linux jobs run on self-hosted runner `docker-ci-build` via repo variable `CI_BUILD_RUNNER_LABEL` — see INV-13 in `AGENTS.md`.

## Stop Conditions

- Gate fails after two focused attempts → STOP, report blockers
- INV violation found → STOP, do not bypass
- Orphan TODO found → fix before proceeding
