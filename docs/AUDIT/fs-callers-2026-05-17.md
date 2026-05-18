# Direct `node:fs` Callers — Audit Baseline

**Date:** 2026-05-17
**Origin:** #824 follow-up — "audit remaining direct fs.\* callers"
**Companion governance:** CANON-17 (FS errno translation), INV-72 (file-lock semantics)

## Scope

This baseline captures every `src/**/*.ts` file that imports `node:fs` or
`node:fs/promises` directly, as of 2026-05-17. It is **descriptive**, not
prescriptive — the goal is to establish a known surface so that:

1. New direct callers introduced by future PRs are visible against this list
2. CANON-17 (errno translation) can be enforced on every entry below
3. A future refactor toward a unified `src/utils/fs.ts` façade has a finite,
   measurable target

## Method

```bash
grep -rln "from 'node:fs\|from \"node:fs" src/ --include="*.ts"
```

Total: **81 files** (as of 2026-05-17).

## Buckets

### 1. Infrastructure utils — direct fs is correct (13 files)

These ARE the abstraction layer; they wrap fs for the rest of the codebase.
Adding a layer above them would be pointless.

- `src/utils/canon-loader.ts`
- `src/utils/config.ts`
- `src/utils/evidence-log.ts`
- `src/utils/file-lock.ts`
- `src/utils/first-run.ts`
- `src/utils/fs.ts` ← the canonical façade (target of CANON-17 promotion)
- `src/utils/plugin-worker.ts`
- `src/utils/profiler.ts`
- `src/utils/render.ts`
- `src/utils/replay.ts`
- `src/utils/run-id.ts`
- `src/utils/safe-read.ts`
- `src/utils/vault-sync.ts`

**CANON-17 status:** each must translate raw errno into ArbiterError at its
own boundary. Verify on PR review.

### 2. Commands — user-visible failure path (25 files)

CLI commands are the highest-priority surface for CANON-17 because their
errors land directly in user terminals.

- `src/commands/agent-rules.ts`
- `src/commands/benchmark.ts`
- `src/commands/blame.ts`
- `src/commands/ci.ts`
- `src/commands/compare.ts`
- `src/commands/diff.ts`
- `src/commands/doctor.ts`
- `src/commands/gauntlet.ts`
- `src/commands/graph.ts`
- `src/commands/harness.ts`
- `src/commands/init.ts`
- `src/commands/integrations.ts`
- `src/commands/knowledge-map.ts`
- `src/commands/plugin.ts`
- `src/commands/report.ts`
- `src/commands/review.ts`
- `src/commands/task-record-red.ts`
- `src/commands/task-record-tech-debt.ts`
- `src/commands/task.ts`
- `src/commands/trace.ts`
- `src/commands/update.ts`
- `src/commands/upgrade-level.ts`
- `src/commands/verify-plan.ts`
- `src/commands/verify.ts`
- `src/commands/worktree.ts`

**CANON-17 status:** must check on every PR that touches these files —
catch handlers must produce ArbiterError, not bare NodeJS.ErrnoException.

### 3. Generators / detectors / graph / etc. — internal, fs-by-nature (43 files)

These read/write files as their primary job. fs is unavoidable; errno
translation matters less because they typically fail behind a parent
command's catch-and-translate wrapper, but still required at the boundary.

- `src/agent-rules/intermediate.ts`
- `src/compare/load-repo.ts`
- `src/compare/workspace.ts`
- `src/compatibility/probe.ts`
- `src/compliance/loader.ts`
- `src/decomposition/markdown-backend.ts`
- `src/detectors/build.ts`
- `src/detectors/existing.ts`
- `src/detectors/framework.ts`
- `src/detectors/git.ts`
- `src/detectors/lanes.ts`
- `src/detectors/language-hooks.ts`
- `src/detectors/language.ts`
- `src/detectors/modules.ts`
- `src/detectors/package.ts`
- `src/evidence/load.ts`
- `src/evidence/tdd.ts`
- `src/generators/claude.ts`
- `src/generators/codex-hooks.ts`
- `src/generators/debt-gates.ts`
- `src/generators/githooks.ts`
- `src/generators/github-setup.ts`
- `src/generators/integration-testing.ts`
- `src/generators/seed.ts`
- `src/graph/builders/adr.ts`
- `src/graph/builders/ast.ts`
- `src/graph/builders/canon.ts`
- `src/graph/builders/req.ts`
- `src/graph/builders/test-nodes.ts`
- `src/graph/builders/utils.ts`
- `src/graph/history.ts`
- `src/graph/load.ts`
- `src/i18n/index.ts`
- `src/integrations/skill-detector.ts`
- `src/notary/staged.ts`
- `src/recipes/loader.ts`
- `src/review/dispatch.ts`
- `src/review/ssot.ts`
- `src/state/backups.ts`
- `src/verify/run.ts`
- `src/worktree/harvest.ts`
- `src/worktree/links.ts`
- `src/worktree/validate.ts`

**CANON-17 status:** verify boundary-level translation in the parent command
or generator that calls these.

## Recommendations

1. **No mass refactor.** 81 files is too many for a single-shot rewrite; risk
   outweighs gain. Treat this list as a baseline and tighten on incremental
   PRs.
2. **CANON-17 enforcement on PR review.** Reviewers cite CANON-17 against any
   new `catch` handler that re-throws or surfaces raw `NodeJS.ErrnoException`.
3. **Promote `src/utils/fs.ts` over time.** When new fs needs arise that
   would land in bucket #3, prefer extending the façade and import from
   `src/utils/fs.ts`. Do NOT block existing code — only fence new direct
   imports.
4. **Promotable to lint.** Once `src/utils/fs.ts` covers ≥80 % of the
   read/write/exists/stat patterns used across the rest, add an ESLint
   `no-restricted-imports` rule for `node:fs` with an allow-list scoped to
   `src/utils/`. Re-baseline this audit at that point.

## Re-audit cadence

Re-run on every major release cut. If the count drifts upward by ≥5 files
without a corresponding INV/CANON addition, open a follow-up to investigate.
