---
generated: true
source: 'docs/case-studies/incidents/05-canon16-refactor-first-saving-file.md'
source_sha: 'e06784c3cfc23dc00a3bcb013f280f8797064b55'
last_updated: '2026-06-08'
---

# Incident: CANON-16 (refactor-first) saving an avoidable file creation

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/case-studies/incidents/05-canon16-refactor-first-saving-file.md](../docs/case-studies/incidents/05-canon16-refactor-first-saving-file.md)

# Incident: CANON-16 (refactor-first) saving an avoidable file creation

**Rule:** CANON-16 — survey for similar code before creating any new source file  
**Policy:** `.claude/rules/35-refactor-first.md`  
**Trigger:** Plan phase — missing "Existing Code Survey" section

---

## What happened

A developer was implementing a new command, `arbiter worktree`, and planned to
create `src/utils/git-ops.ts` — a utility for git operations like
`worktree add`, `worktree remove`, and `branch --show-current`.

The plan was submitted without an "Existing Code Survey" section, which is a
CANON-16 violation.

## What the survey found

When prompted to run the survey before proceeding:

```bash
grep -r "export function.*git\|execFileSync.*git\|spawnSync.*git" src/ --include="*.ts" -l
```

Result:

```
src/utils/run-cli.ts
src/commands/update.ts
src/commands/doctor.ts
```

Reading `src/utils/run-cli.ts` revealed an existing `runGit()` helper that
already wrapped `execFileSync('git', [...])` with error handling, timeout,
and the approved non-shell spawn path (INV-12).

The `update.ts` command already used `runGit(['branch', '--show-current'])`.

## The decision

Instead of creating `src/utils/git-ops.ts`, the developer:

1. Extended `runGit()` in `run-cli.ts` with a typed options parameter for
   `cwd` and `timeout` overrides (the worktree command needed to run git
   in a different directory)
2. Added the three worktree operations as thin wrappers in `run-cli.ts`
3. Deleted the planned `src/utils/git-ops.ts` from the file list

Total new lines: ~30 (in an existing file vs. a new file + re-export chain).

## Impact

The refactor saved:

- One new file with its own import surface
- One new test file setup
- Two `index.ts` export additions
- Future maintainers having to decide "which git util do I use?"

The worktree command shipped using existing infrastructure. The survey took
5 minutes; the avoidable file would have taken an hour to write and test.

## Takeaway

CANON-16 is not a bureaucratic hurdle. It is the question every senior
developer asks before writing code: "does this already exist?" The survey
cost is measured in minutes. The cost of a duplicate abstraction is measured
in months of future confusion.
