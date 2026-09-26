# PREMORTEM #2919(a) — `gateLockPathFor` ignores inherited `GIT_DIR`/`GIT_WORK_TREE`

Base `d70eb7c7`. Scope: part (a) only; part (b) (pool/flake measurement) stays open on #2919.

### 2.1 Plan `.claude/plans/task-2919.md`
```yaml
---
context:
  issue: '#2919'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2919-gate-lock-git-env'
  base_branch: main
  key_constraints:
    - 'Scope (a) only: strip git redirect env in gateLockPathFor; no pool/vitest.config change (b = measurement)'
    - 'Twin identical (scripts/lib/gate-mutex.mjs ↔ .ejs); examples regenerated; 27 bake lanes rebaked'
  red_team_warnings:
    - 'This is hardening, not the CI flake cure: CI has no GIT_* on the path (CI premortem). Say so; do not close #2919'
    - 'src/commands/gate-exec.ts deriveGateKey has the same hole: follow-up issue, not scope growth'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2919.md
files:
  - .claude/plans/task-2919.md
  - .claude/plans/PREMORTEM_2919.md
  - scripts/lib/gate-mutex.mjs
  - src/templates/scripts/lib/gate-mutex.mjs.ejs
  - __tests__/scripts/gate-lock-git-env-2919.test.ts
  - examples/go-library/scripts/lib/gate-mutex.mjs
  - examples/python-library/scripts/lib/gate-mutex.mjs
  - examples/ts-library/scripts/lib/gate-mutex.mjs
  - .arbiter/evidence/tdd/#2919.json
  - __tests__/integration/e2e/bake/__snapshots__/go-backend-web-gcr.json
  - __tests__/integration/e2e/bake/__snapshots__/go-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/go-library.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-acr.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-bdd-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-library-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
  - __tests__/integration/e2e/bake/__snapshots__/multi-lane-fe-be.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web-ecs.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web.json
  - __tests__/integration/e2e/bake/__snapshots__/python-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/python-data-pipeline.json
  - __tests__/integration/e2e/bake/__snapshots__/python-library.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-cli.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-embedded.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-library.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-ghcr.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-none.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-codex-only.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-frontend-spa.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-library.json
  - __tests__/integration/e2e/bake/__snapshots__/vue-frontend-spa.json
  # + any examples/*/.arbiter-generated-manifest.json that examples:regenerate rewrites (add after regenerating)
---
```
PR body: `Refs #2919` (**not** Closes), because AC-1/AC-2 of the issue (determinism, 20 loaded runs) stay open.
### 2.2 Map, RED, GREEN
- `scripts/lib/gate-mutex.mjs:70-74`: `execFileSync('git', ['rev-parse','--git-common-dir'], { cwd: dir, encoding })` has no `env`,
  so it inherits `process.env` (`env` param feeds only `XDG_RUNTIME_DIR`, :78). Callers `:282`, `:310`, `capacity-probe`, `check-all`; no kernel copy.
- RED `__tests__/scripts/gate-lock-git-env-2919.test.ts` (77 lines). It builds tmp repos A and B,
  first asserts `gateLockPathFor(A) !== gateLockPathFor(B)` (non-vacuity), then points `process.env.GIT_DIR`/`GIT_WORK_TREE`/
  `GIT_INDEX_FILE` at B and asserts A still resolves to its own lock. It does not spawn a nested vitest (the #2923 MED).
  - Base: `exit 1`, `× an inherited GIT_DIR pointing at repo B does not steal repo A's lock path`, `AssertionError: expected
    '…/1a7c64c22da9be…' to be '…/e83779a56679b8…'`. Trial GREEN: 1 passed; `gate-mutex` + `capacity-probe` +
    `check-all-bootstrap` pass (64 tests); typecheck clean. Single AC, so no cross-AC check applies.
  - `record-red`: `node dist/cli.js lifecycle record-red --task '#2919' --test-path <RED> --test-command npx --test-arg vitest
    --test-arg run --test-arg <RED>` with `<RED>` = `__tests__/scripts/gate-lock-git-env-2919.test.ts`.
```diff
+// Same set .githooks/pre-push unsets: an inherited redirect must not move the lock to another repo.
+const GIT_REDIRECT_ENV = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']
 export function gateLockPathFor(dir = process.cwd(), env = process.env) {
+  const gitEnv = { ...process.env }; for (const key of GIT_REDIRECT_ENV) Reflect.deleteProperty(gitEnv, key)
-  … execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf-8' })
+  … execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf-8', env: gitEnv })
```
Base the git env on `process.env` (what git sees today), not the `env` param (which today feeds only `XDG_RUNTIME_DIR`); the
trial used `{...env}` and both pass the RED. Make the identical edit in the `.ejs`, then run `npm run examples:regenerate`.
### 2.3 Verification (foreground, in order)
`npm run build` → `npx vitest run` RED + `gate-mutex` + `capacity-probe` + `check-all-bootstrap` → twin diff empty → `npm run
typecheck && npm run lint` → 2 debt gates → `npm run examples:regenerate && npm run examples:check` → `node
scripts/check-self-dogfood.mjs` → `BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake`, then `npm run test:e2e:bake` → update `files:`
→ commit snapshots **last** → commitlint → `check-all.mjs L1` → `L2` once. `[skip-docs]` in the commit body.
### 2.4 Premortem
| # | Failure | L | Prevention |
|---|---|---|---|
| 1 | PR claims to fix the CI timeout / closes #2919 | H | `Refs #2919`; CI premortem: no `GIT_*` reaches the CI step; part (b) points at host load |
| 2 | `deriveGateKey` (`src/commands/gate-exec.ts:61`) keeps the hole, so under a hostile GIT_DIR the two derivations diverge; the byte-identity pin test uses a clean env and stays green | M | File a follow-up. Do not touch `src/` (publicApiSurface is at its limit) |
| 3 | Twin, examples or 27 bake lanes drift | H | §2.3 order; bake last |
| 4 | Var list misses `GIT_CONFIG_PARAMETERS`/`GIT_CEILING_DIRECTORIES` | L | Matches the `.githooks/pre-push` convention. Reviewer may widen it; that is harmless |
**Reviewer threat model:** the RED restores `process.env` (`finally` + `afterEach`, verified); non-vacuity (A≠B before the hostile env); twin byte-identity; env source; snapshot churn limited to
the gate-mutex hash; honest scope in the PR body.
