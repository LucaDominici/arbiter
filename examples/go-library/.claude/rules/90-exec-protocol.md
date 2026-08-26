# Execution Protocol

## Branch Enforcement

Before any file edit:
1. Run `git branch --show-current`
2. If on `main` → stop and create a task branch first — edits on `main` bypass every review and gate artifact that anchors to a task branch
3. Branch must start with `task/` — e.g., `task/#123-description`

## Execution Flow

1. Read AGENTS.md (invariants + governance)
2. Create task branch if not on one
3. Plan before editing (3+ file changes → outline first)
4. Run `/ship #NNN` — the single orchestration entrypoint (auto-sequences plan → review → gate → merge)
5. Implement with TDD (test first) — `/ship` drives each phase; `/task` subcommands for recovery only
6. Run `node scripts/check-all.mjs L1` before commit
7. Run `node scripts/check-all.mjs L2` before push

## Gate Commands

```bash
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```

## Stop Conditions

- Gate fails after two focused attempts → STOP, report blockers
- INV violation found → STOP, do not bypass
- Orphan TODO found → fix before proceeding
- Symptom patch over a known smell (duplicate-of-existing-helper, missed extraction) without `arbiter task record-tech-debt` → STOP

## Root-Cause Discipline (CANON-22)

When a change touches code that the duplication (jscpd), complexity, or dead-code gates flag:

- **Fix the root cause** in the smelly/duplicated code you touch — extract the shared helper, simplify the over-complex function, delete the dead branch.
- **OR** run `arbiter task record-tech-debt` with an explicit rationale (why the root-cause fix is out of scope now) before proceeding.
- A symptom-only patch layered over a known smell — duplicating a helper that already exists, widening a function already over the complexity ceiling — is a stop condition, not a tradeoff. The duplication ratchet (Lehman entropy) blocks any net increase regardless of intent.
