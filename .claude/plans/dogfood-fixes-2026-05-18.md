# Dogfood Matrix Fixes — 2026-05-18

## Context

Local dogfood run on 2026-05-17 against all 19 fixtures × declared levels (55 cells)
produced **0/55 pass**. Evidence:
`.arbiter/evidence/dogfood/2026-05-17T23-20-34-335Z/{results.json,report.md}`.

Driver: `scripts/dogfood-local.mjs` (replica of `real-project-matrix.yml:115-159`).
Toolchain installed Phase 0: Go 1.22.10 + 1.25.10 (tarball, `~/.local/go/bin`),
Gradle 8.8 (SDKMAN), staticcheck, govulncheck, cargo-audit, cargo-tarpaulin,
pip-audit, pytest-cov, gitleaks. Build: `npm run build` clean.

Failures cluster into **8 distinct root causes**. P0 (single fix) unblocks ~20 cells.
Plan below is ordered by blast-radius descending.

---

## P0a — `.claude/settings.json` hook commands use relative paths

**Blast radius:** every Edit|Write while Bash cwd is non-root. Surfaces as `node:internal/modules/cjs/loader:1386 — Cannot find module '<cwd>/.claude/hooks/<name>.mjs'`. Non-blocking (hook chain marks status informational, writes succeed), but pollutes logs and risks future blocking hooks misfiring.

**Symptom (observed 2026-05-17):**
```
Failed with non-blocking status code: node:internal/modules/cjs/loader:1386
Error: Cannot find module '/home/luca/work/repos/arbiter/.arbiter/evidence/dogfood/<ts>/.claude/hooks/post-commit-check.mjs'
    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)
```

**Root cause:**
- `.claude/settings.json` hooks use bare relative paths: `"command": "node .claude/hooks/X.mjs"`.
- Bash tool persists cwd across commands. A `cd` into any subdirectory (e.g. `.arbiter/evidence/dogfood/<ts>/` to inspect results) leaks to the harness's hook invocation cwd.
- Hook resolution becomes `<leaked-cwd>/.claude/hooks/X.mjs` → MODULE_NOT_FOUND.
- ~16 entries affected in `PreToolUse` + `PostToolUse` + `UserPromptSubmit` + `PreCompact`.

**Fix:**
- Replace `"node .claude/hooks/X.mjs"` → `"node $CLAUDE_PROJECT_DIR/.claude/hooks/X.mjs"` across all entries in `.claude/settings.json`.
- `$CLAUDE_PROJECT_DIR` is set by Claude Code harness, always points at repo root, independent of shell cwd.
- Audit other relative-path hook commands (e.g. any `bash .claude/...`, `node scripts/...` if present).
- Add gate guard `scripts/check-hook-paths.mjs`: assert every hook command in `.claude/settings.json` starts with `$CLAUDE_PROJECT_DIR/` (or absolute path). Wire into L1.

**Verify:** `cd /tmp && echo test | node $CLAUDE_PROJECT_DIR/.claude/hooks/check-no-orphan-todo.mjs` resolves. Then trigger a Write while Bash cwd is `/tmp` — no MODULE_NOT_FOUND.

**Files:** `.claude/settings.json`, `scripts/check-hook-paths.mjs` (new), `scripts/check-all.mjs` (wire).

**Branch:** do NOT pile this on `task/ci-tier-impl`. New branch `task/hook-path-portability` off `main`. Single small commit.

---

## P0b — Build script drops `cross-language-matrix.json` from dist

**Blast radius:** ~20 cells (every fixture@L3 init + L2 contract-testing + multi-lane-fe-be).

**Symptom (16 cells):**
```
init :: Unexpected error: Cannot find module '../compatibility/cross-language-matrix.json'
```

**Root cause:**
- `src/utils/maturity-check.ts:29` does `require('../compatibility/cross-language-matrix.json')`.
- Build script (`package.json` build): `tsc && rm -rf dist/templates && cp -r src/templates dist/templates && mkdir -p dist/i18n && cp src/i18n/*.json dist/i18n/`.
- TSC does not copy non-template `.json` files. `dist/compatibility/` contains only `matrix.json` (committed alongside `.ts`), not `cross-language-matrix.json`.
- L3 generators trigger this code path; L1/L2 mostly avoid it. L2 hits via `contract-testing` generator on backend fixtures.

**Fix:**
1. Add to `package.json` build script:
   `mkdir -p dist/compatibility && cp src/compatibility/*.json dist/compatibility/`
2. Add gate guard `scripts/check-dist-completeness.mjs`: walk `src/**/*.json` and assert each has a counterpart in `dist/`. Wire into L1 gate.
3. (Defensive) Rewrite `maturity-check.ts:29` to use `readFileSync(join(__dirname, '..', 'compatibility', 'cross-language-matrix.json'))` so the failure mode is the same in dev/dist (both go through fs, never require resolution).

**Verify:** rerun `node scripts/dogfood-local.mjs --levels=L3 --min-pass=1` → expect L3 init to clear, downstream errors will surface (separate plans).

**Files:** `package.json`, `src/utils/maturity-check.ts`, `scripts/check-dist-completeness.mjs` (new), `scripts/check-all.mjs` (wire).

---

## P1a — BDD scaffolding leaks into non-BDD Rust archetypes

**Blast radius:** 4 cells (rust-cli@L1, rust-embedded@L1, rust-library@L1, rust-library@L2).

**Symptom:**
```
error[E0432]: unresolved import `cucumber`
error[E0433]: failed to resolve: use of unresolved module or unlinked crate `tokio`
error[E0599]: no function `run` for `ExampleWorld`
```

**Root cause:** `behavioral-tests` generator emits `tests/example_bdd_test.rs` for archetype=library/cli/embedded. BDD is its own archetype — should not scaffold for non-BDD. Cargo.toml of these fixtures does not declare cucumber/tokio, so cargo test breaks.

**Fix:**
- `src/generators/behavioral-tests.ts`: gate emission on `archetype === 'bdd'` OR explicit opt-in flag. For now: archetype-only emission.
- Audit other behavioral-tests templates (Java/TS/Python/Go) for same leak. Java equivalent appears in `java-library-gradle@L1` (`ExampleBddIT.java cannot find symbol`) — same fix.

**Verify:** `node scripts/dogfood-local.mjs --filter='rust-*' --levels=L1`.

**Files:** `src/generators/behavioral-tests.ts`, possibly `src/generators/registry.ts` (gating).

---

## P1b — EJS template fails to render: `behavioral-tests/bdd/ExampleBddIT.java.ejs`

**Blast radius:** 4 cells (java-bdd-gradle@L1/L2, multi-lane-fe-be@L1/L2).

**Symptom:**
```
[registry] generator 'behavioral-tests' failed: dist/templates/behavioral-tests/bdd/ExampleBddIT.java.ejs:1
```

**Root cause:** Template line 1 references variable not in render context. Inspected: `package <%= basePackage || 'com.example' %>.bdd;` — likely `basePackage` undefined and the `||` short-circuit still throws because EJS strict mode treats undefined symbol as ReferenceError (vs falsy).

**Fix:** Change line 1 to `package <%= typeof basePackage !== 'undefined' ? basePackage : 'com.example' %>.bdd;` OR pre-default `basePackage` in the generator before render.

**Verify:** `node scripts/dogfood-local.mjs --filter='java-bdd-*'`.

**Files:** `src/templates/behavioral-tests/bdd/ExampleBddIT.java.ejs`, possibly `src/generators/behavioral-tests.ts`.

---

## P1c — `rust-bdd` cargo dep resolution fails at verify

**Blast radius:** 2 cells (rust-bdd@L1, rust-bdd@L2).

**Symptom:**
```
verify :: cargo:check exit 101 — failed to select a version for `cucumber`
```

**Root cause:** Fixture `Cargo.toml` pins a cucumber version that no longer exists / breaks resolution OR init injected an incompatible version.

**Fix:** Inspect `__tests__/fixtures/real-projects/rust-bdd/Cargo.toml` vs what init mutates. Pin compatible versions in fixture; ensure init does not rewrite already-correct manifests.

**Files:** `__tests__/fixtures/real-projects/rust-bdd/Cargo.toml`, possibly `src/generators/cargo-manifest.ts`.

---

## P1d — TS BDD fixture missing `@types/node`

**Blast radius:** 2 cells (ts-bdd@L1, ts-bdd@L2).

**Symptom:**
```
verify :: tsc:noEmit exit 2 — Cannot find type definition file for 'node'
```

**Root cause:** Fixture `tsconfig.json` declares `"types": ["node"]` (TS6 requirement, per memory `project_typescript6_migration`) but `@types/node` not in devDependencies. Driver runs `npm install` first but fixture package.json lacks the dep.

**Fix:** Add `@types/node` to `__tests__/fixtures/real-projects/ts-bdd/package.json` devDependencies. Also audit other TS fixtures (ts-backend-web-db has similar `Cannot find module 'express'` likely same root cause for `@types/express`).

**Files:** `__tests__/fixtures/real-projects/{ts-bdd,ts-backend-web-db}/package.json`.

---

## P2a — `python-backend-web` pip-install fails

**Blast radius:** 3 cells (python-backend-web@L1/L2/L3).

**Symptom:**
```
pip-install :: ModuleNotFoundError: No module named 'setuptools.backends'
```

**Root cause:** Python 3.12 setuptools renamed/deprecated `setuptools.backends`. Fixture `pyproject.toml` likely declares `build-backend = "setuptools.backends.distutils"` or older path.

**Fix:** Update `__tests__/fixtures/real-projects/python-backend-web/pyproject.toml` to use modern backend: `build-backend = "setuptools.build_meta"`. Verify on Python 3.12.

**Files:** `__tests__/fixtures/real-projects/python-backend-web/pyproject.toml`.

---

## P2b — `markdown-only` fixture has no `package.json` but driver `npm install`s

**Blast radius:** 3 cells (markdown-only@L1/L2/L3).

**Symptom:**
```
npm-install :: ENOENT — /tmp/.../markdown-only-LX/package.json
```

**Root cause:** Driver `preInitDeps` assumes language=typescript → run `npm install`. Fixture manifest declares `language: typescript` but the fixture is a docs-only project (no `package.json`).

**Fix:**
- Driver: skip language-specific install when expected manifest file (package.json / pyproject.toml / go.mod / Cargo.toml) absent. Treat as no-op + log.
- OR fixture: add minimal stub `package.json` so npm install is a no-op.

Driver fix is cleaner — generalizes for future docs-only fixtures.

**Files:** `scripts/dogfood-local.mjs` (preInitDeps gating).

---

## P2c — Generated `check-all.mjs` references missing module `rx`

**Blast radius:** 2 cells (ts-frontend-spa@L2, ts-library@L2).

**Symptom:**
```
check-all :: Error: Cannot find module 'rx'
```

**Root cause:** A generated check at L2 imports `rx` (package name). Either typo for `rxjs` or a deleted dep that templates still reference.

**Fix:** Grep `src/templates/**/*.ejs` for `require('rx')` / `import.*'rx'` — remove or replace. Most likely a template bug.

**Files:** templates under `src/templates/check-all/` or `src/templates/lint/`.

---

## P2d — Python lint/format/unit FAIL across multiple fixtures (ruff missing locally)

**Blast radius:** ~4 cells (python-data-pipeline@L1/L2, python-library@L1/L2) — partial, local-env.

**Symptom:**
```
verify :: [skipped] ruff (toolchain-missing) :: build tool missing: ruff
check-all :: lint FAIL / format FAIL / unit tests FAIL
```

**Root cause:** `ruff` not installed in local toolchain. Real-project-matrix workflow installs it explicitly on the runner. Phase 0 install missed `ruff`.

**Fix:** Add to local prereq: `pip install --user ruff black` (or via uv). Update `docs/DEVELOPMENT/REAL-PROJECT-TESTING.md:148-156` checklist to list ruff explicitly under "L1 prereqs" (currently it lists ruff only as implied via pyproject — should be explicit). Also update driver to detect missing common tools and skip-with-explicit-reason rather than counting as logical FAIL.

**Files:** `docs/DEVELOPMENT/REAL-PROJECT-TESTING.md`, optional `scripts/dogfood-local.mjs` toolchain probe.

---

## P3 — Misc single-cell issues (deferred, low blast radius)

| Cell | Failing step | Hypothesis | Next step |
|---|---|---|---|
| `go-bdd@L1` | check-all (`go vet` + lint) | `go.sum` missing entry for godog (init didn't run go mod tidy) | inspect `dist/templates/check-all/go.ejs`; ensure generator runs `go mod tidy` after dep injection |
| `go-bdd@L2` | staticcheck + coverage threshold | check-all path issue + coverage 0 | downstream of go-bdd@L1 fix |
| `go-library@L1` | gofmt + vet + lint | similar — generated source not gofmt'd | template formatting fix |
| `go-library@L2` | staticcheck + coverage profile | downstream of L1 |
| `java-backend-web-db-gradle@L1` | `DeprecationInterceptor.java` cannot find symbol | fixture-level missing import in middleware skeleton | add Spring-Web import / annotate `@Component` correctly |
| `java-library-gradle@L2` | `Task 'pitest' not found` | L2 pitest gradle plugin not added to `build.gradle` | mutation generator missing plugin block in L2 |
| `rust-cli@L2` | clippy `#[must_use]` error | L2 clippy lint too strict | downgrade pedantic-class warning to allow in L2 OR fix fixture |
| `ts-backend-web-db@L1` | tsc missing `express` types | fixture devDeps incomplete | add `@types/express` etc. |
| `ts-frontend-spa@L1` | npm script `test:unit` missing | init didn't add script to package.json for SPA archetype | generator fix |
| `ts-library@L1` | format FAIL + unit FAIL | likely cascading from missing tooling install OR generator script mismatch | inspect tail in evidence |

---

## Execution Order Tomorrow

Sequence is **strict** — each step de-risks the next by reducing matrix noise.

0. **P0a hook path fix** (10 min, branch `task/hook-path-portability`): sed `.claude/settings.json` to prefix all hook commands with `$CLAUDE_PROJECT_DIR`. Add `scripts/check-hook-paths.mjs` guard. Commit + merge to `main` before continuing — eliminates noise from MODULE_NOT_FOUND on any cwd change.
1. **P0b build fix** (5 min): patch `package.json` build script, rebuild, run dogfood matrix again.
   Expected delta: ~20 cells flip from `init` fail to next-step fail. Re-cluster.
2. **P1a + P1b together** (30 min): generator gating for archetype + EJS template
   fix. Expected delta: ~8 cells flip out of init/verify into check-all.
3. **P1c + P1d + P2a + P2b** (45 min): fixture-level dep / pyproject / driver gating.
   Expected delta: ~10 cells flip into check-all.
4. **P2c** (20 min): grep+replace `rx` → `rxjs` in templates. ~2 cells.
5. **P2d** (5 min): install ruff locally + doc update.
6. **P3** misc (1-2 hours): single-cell investigations. Decide which to fix vs file as issues.
7. **Final dogfood matrix run**: target ≥ 30/55 pass (`MIN_PASS=30`) before declaring round complete.

Each P-class fix is one commit on its own branch off `main` (NOT on `task/ci-tier-impl`).
Driver script `scripts/dogfood-local.mjs` and this plan: decide whether to commit on a
new branch `task/local-dogfood-runner` (recommended) OR keep as session-scratch.

---

## Critical Files (Read Before Starting Tomorrow)

| Path | Why |
|---|---|
| `.arbiter/evidence/dogfood/2026-05-17T23-20-34-335Z/results.json` | Full structured results, per-step tails |
| `.arbiter/evidence/dogfood/2026-05-17T23-20-34-335Z/report.md` | Per-cell failure tail |
| `scripts/dogfood-local.mjs` | Driver — modify `preInitDeps` for P2b |
| `package.json` build script | P0 patch |
| `src/utils/maturity-check.ts:29` | P0 require call |
| `src/templates/behavioral-tests/bdd/ExampleBddIT.java.ejs:1` | P1b |
| `src/generators/behavioral-tests.ts` | P1a archetype gating |
| `__tests__/fixtures/real-projects/{rust-bdd,ts-bdd,ts-backend-web-db,python-backend-web}/` | Fixture-level fixes |

## Verification (End of Tomorrow)

```bash
npm run build
node scripts/dogfood-local.mjs --min-pass=30
```

Pass floor lifted to **30/55** (≈55%) for declaring this remediation round complete.
Remaining failures get filed as separate GH issues under label `dogfood-2026-05`.

## Out of Scope (Defer)

- Synthetic matrix combos beyond fixtures (handled by `matrix-smoke.yml`)
- CI-tier T0-T6 wiring into init (separate plan, `docs/SYSTEM/CI-TIER-MODEL.md`)
- Package-manager fan-out (npm/bun/yarn) — not exposed via init flags yet
