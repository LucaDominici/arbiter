# Premortem — arbiter #2934 + #2935 (one PR)

Base `d70eb7c7`. Copied from the coordinator premortem, §1 (workspace paths removed).

## 1. P1: #2934 (no test writes into the tree) + #2935 (refutation fixture pins its root)
### 1.1 Plan `.claude/plans/task-2934.md` (PR body: `Closes #2934`, `Closes #2935`)
```yaml
---
context:
  issue: '#2934'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2934-test-tree-hygiene'
  base_branch: main
  key_constraints:
    - 'Also closes #2935 (disjoint files, same test-hygiene class); two commits, one per issue'
    - 'Tests only + one data literal in guard-flip-registry.mjs; no src/, no template, no bake'
  red_team_warnings:
    - 'Keep the #2643 residue proof: move it to a tmp git repo, do not just delete it'
    - 'The #2935 test must plant the host task in a tmp copy of the script, never in the real .claude/.task'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2934.md
files:
  - .claude/plans/task-2934.md
  - .claude/plans/PREMORTEM_2934.md
  - __tests__/scripts/no-tree-writes-2934.test.ts
  - __tests__/scripts/guard-flip-host-task-2935.test.ts
  - __tests__/docs/wiki-migrate-1244.test.ts
  - scripts/lib/guard-flip-registry.mjs
  - .arbiter/evidence/tdd/#2934.json
---
```
### 1.2 Map (d70eb7c7)
| Issue | Site | Today |
|---|---|---|
| 2934 | `wiki-migrate-1244.test.ts:33-43` | `beforeAll` creates `docs/METHOD/KNOWLEDGE_MAP.md` in the **real tree** (the #2643 residue: an untracked file must not count as tracked), and `afterAll` deletes it. While the file is live, a parallel `check-doc-style.mjs` spawn sees it. |
| 2935 | `guard-flip-registry.mjs:398-404` | `argv: (d) => ['--evidence-dir', join(d,'returns')]` has no `--repo-root`. `check-refutation-verdicts.mjs:47` defaults ROOT to the **script's own parent** and reads `<ROOT>/.claude/.task/status.json`. When a task is declared, it looks for the marker under the sanitized task id and finds none, because the fixture wrote `returns/task/`. It then exits 0 on the planted-BAD fixture: vacuous. |
### 1.3 Guard choice and its cost (#2934 AC-2)
- **Chosen: static scan test** (`red-2934`): over `git ls-files __tests__` `*.test.ts`, flag a file that defines `const ROOT =
  resolve(__dirname…`, calls `writeFileSync|mkdirSync|appendFileSync|copyFileSync|cpSync|renameSync` on `r(…)`/`*ROOT`, and never
  uses `mkdtempSync`/`tmpdir()`. **Cost:** about 30 ms (measured 27–29 ms), no fork-parallelism false positives, and it catches the
  transient-write class behind #2934. **Ceiling:** it is lexical, so it misses writes via `process.cwd()`, helpers or string paths,
  and any `mkdtempSync` exempts the whole file. On base it finds exactly 1 offender (`wiki-migrate-1244`).
- **Rejected:** widening the existing `__tests__/setup/tracked-claude-guard.ts` (globalSetup; hashes `.claude` only) to a whole-tree
  `git status --porcelain`: about 0.1–0.3 s per project, but it samples at suite boundaries, so it **would not have caught #2934**.
### 1.4 RED (two new files; one RED commit)
Copy the coordinator RED 2934 → `__tests__/scripts/no-tree-writes-2934.test.ts` and the coordinator RED 2935 →
`__tests__/scripts/guard-flip-host-task-2935.test.ts` verbatim (Prettier-clean, 0 eslint errors). `red-2935` copies
`check-refutation-verdicts.mjs` + `lib/gate-args.mjs` into a tmp "host", plants `<host>/.claude/.task/status.json` = `#9999`, and
runs `flipGuard({...guard, script: <host copy>}, entry)`. (A first draft wrote the **real** `status.json`; replaced.)
`record-red` (after `npm run build`; one task, both files): `node dist/cli.js lifecycle record-red --task '#2934' --test-path
__tests__/scripts/no-tree-writes-2934.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg <RED 2934> --test-arg <RED 2935>`.
Scratch runs (`npx vitest run <2 REDs> __tests__/docs/wiki-migrate-1244.test.ts`):
```
base:           exit=1  2 failed | 151 passed
  × no __tests__/**/*.test.ts file mutates the tree via its ROOT/r() helper without a tmp root  (["…/wiki-migrate-1244.test.ts"])
  × rejects the planted BAD fixture even when the host declares a task  ("accepted a planted BAD fixture (exit 0, expected 1) — VACUOUS")
only #2934 fix: exit=1  1 failed (× rejects the planted BAD fixture …)  | only #2935 fix: exit=1  1 failed (× no __tests__/** …)
both fixes:     exit=0  3 files, 153 passed; after `npm run build` (needed by build-kernel-plugin): check-guard-flip + doc-gate-allowlist-2917 → 40 passed
```
### 1.5 GREEN (full trial diff: the coordinator trial diff)
```diff
# scripts/lib/guard-flip-registry.mjs  ('refutation-verdicts')
-    argv: (d) => ['--evidence-dir', join(d, 'returns')],
+    argv: (d) => ['--evidence-dir', join(d, 'returns'), '--repo-root', d],
# __tests__/docs/wiki-migrate-1244.test.ts (+ tmpdir, mkdtempSync imports)
-const trackedExists = (p: string) => { … { cwd: ROOT, …        +const trackedExists = (p: string, cwd = ROOT) => { … { cwd, …
-RESIDUE_PATH = r('docs/METHOD/KNOWLEDGE_MAP.md') + beforeAll/afterAll mkdir/write/rm IN THE TREE
+RESIDUE_REPO = mkdtempSync(join(tmpdir(), 'wiki-1244-residue-')); beforeAll: git init -q + write docs/METHOD/KNOWLEDGE_MAP.md
+afterAll(() => rmSync(RESIDUE_REPO, { recursive: true, force: true }))
+  (in 'docs/METHOD/KNOWLEDGE_MAP.md is deleted') expect(trackedExists('docs/METHOD/KNOWLEDGE_MAP.md', RESIDUE_REPO)).toBe(false)
```
### 1.6 Verification (foreground, in order)
`npm run build` → `npx vitest run` on the 2 REDs + `wiki-migrate-1244` + `check-guard-flip` + `doc-gate-allowlist-2917` → `npm run
typecheck && npm run lint` → publicApiSurface (1174) and complexity (226) gates → `node scripts/check-guard-flip.mjs` (`vacuous=0`)
→ `git status --porcelain` (only the diff) → commitlint → `check-all.mjs L1` → `L2` once. No examples/bake/self-dogfood step.
### 1.7 Premortem
| # | Failure | L | Prevention |
|---|---|---|---|
| 1 | Writer "fixes" #2934 by moving the residue to a tmp dir with no git repo, which drops the #2643 proof silently | H | §1.5: tmp **git** repo, and the helper takes `cwd` |
| 2 | The #2935 test plants the real `.claude/.task/status.json` (first draft did) and clobbers a live task, racing other tests | H | Tmp host copy (red-2935). Reviewer greps the test for `ROOT, '.claude'` |
| 3 | The guard is widened into a runtime `git status` diff and claimed to cover #2934 | M | §1.3: it cannot see a write already cleaned up in `afterAll`. Name the ceiling in the test header |
| 4 | Other `file-scan` fixtures in the registry have the same missing `--repo-root` | M | Out of scope. Reviewer may ask; answer with a follow-up issue, not scope growth |
**Reviewer threat model:** the guard is lexical, not a sandbox (say so). The #2643 residue assertion keeps its teeth (untracked ≠
tracked, in a real git repo). `--repo-root d` leaves the clean-fixture verdict at exit 0. No test in the diff writes under `ROOT`.
