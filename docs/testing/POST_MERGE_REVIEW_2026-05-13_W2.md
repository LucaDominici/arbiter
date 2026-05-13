# Post-Merge Review — Wave 2 — 2026-05-13

Wave 2 covers the `#280` command-side cluster: 4 parallel worktrees, 13 issues total,
all merged to main on 2026-05-13.

---

## Clusters Merged

### W2C — #309 #310 #311 — upgrade-level fixes (PR #494)

**Issues:**

- #309: `upgrade-level.ts` wrong message — condition was `current === 'L1'` instead of `current === 'L1' && target === 'L2'`
- #310: missing `validateConfig` before `saveConfig` in upgrade-level
- #311: `JSON.parse` of `grace-log.json` unchecked; added try/catch + `Array.isArray` guard

**Red-team findings filed:**

- #498 (sev 5): `runCli` invoked before config is saved — CLI executes with stale config state
- #499 (sev 4): grace-log path silently overwrites on every run even when entry exists

**Gate:** L1 green. L2 green post-merge.

---

### W2D — #312 #318 #326 #327 — worktree/harvest/prompts fixes (PR #495)

**Issues:**

- #312: `parsePorcelainStatus()` helper handles R/C status entries (rename/copy) correctly
- #318: `isUserCancellation()` + try/catch around inquirer calls in `wizard/prompts.ts`
- #326: type guards `isOpenLogEntry`/`isCloseLogEntry` replacing `as X[]` casts in `worktree.ts`
- #327: resolve relative symlink targets against link's parent dir in `links.ts`

**Red-team findings filed:**

- #500 (sev 6): `git status --porcelain` without `-z` flag — breaks on filenames with newlines/special chars
- #501 (sev 4): `indexOf(' -> ')` rename separator ambiguous for filenames containing `->`
- #502 (sev 3): type guards `isOpenLogEntry`/`isCloseLogEntry` check only shared fields, not discriminating ones

**Gate:** L1 green. L2 green post-merge.

---

### W2A — #305 #317 #320 #325 — init.ts tool allowlist + runPlugins (PR #496)

**Issues:**

- #305: `AI_TOOLS` in `schema.ts` and `VALID_TOOLS` in `configure.ts` expanded from 4 → 7 tools (added gemini, windsurf, aider)
- #317: `generateAndFinalize` made async; loads stored config before `saveConfig`; calls `runPlugins`
- #320: `runPlugins` now collects all plugin failures and throws aggregate `Error` (was console.warn)
- #325: `parseTools` and `parseLevel` now throw on invalid input (were silently accepting bad values)

**Blocking red-team fix (pre-merge):**

- `runPlugins` call in `update.ts` had no try/catch after #320 made it throw. Added `handlePluginError`
  helper + `.catch()` pattern to protect the call site without exceeding `max-lines-per-function`
  (ESLint: 100 lines, complexity: 15).

**Commit history note:** Original W2A commit had a body line >100 chars (commitlint violation).
Fixed via `git reset --soft HEAD~2` + clean squash commit (2939eca).

**Gate:** L1 green after fix. L2 green post-merge.

---

### W2B — #306 #322 #324 — update.ts + configure surface (PR #497)

**Issues:**

- #306: `v2ToProjectConfig` restores `stored.basePackage` into `ProjectConfig`; `nextConfig` constructed correctly
- #322: `nextConfig` constructed BEFORE `selectAndRun` so snapshot diff is correct (was after — axis loss)
- #324: axis fields (`archetype`, `architectureStyle`, `isMultiTenant`, `hasDatabase`, `hasPublicApi`, `contractType`) added to `ALLOWED_PATHS` in `configure.ts` + `parseAxisValue()` helper

**W2B depended on W2A:** W2A's 7-tool `VALID_TOOLS` must exist before W2B rebases. Merged W2A first,
then W2B rebased onto main — VALID_TOOLS conflict resolved cleanly.

**Docs check fix:** `check-docs.mjs` requires docs/ change when src/ changes. Added axis field rows
to `docs/REFERENCE/CLI.md` + ran prettier.

**Red-team findings filed:**

- #503 (sev 6): `basePackage` not validated by `validateConfig` — non-string value passes through
- #504 (sev 5): setting `archetype` via `configure` does not cascade derived fields (hasDatabase etc.)

**Gate:** L1 green. L2 green post-merge.

---

## Main Gate — Post All Merges

```
node scripts/check-all.mjs L2
```

Result: **ALL PASSED** (2026-05-13, after W2B merge).

Pre-existing known failures (all `#` worktrees, not regressions):

- `plugin-loader.test.ts` (4 tests)
- `example-plugin-spring-boot.test.ts` (2 tests)

---

## Red-Team Summary

| Cluster | Sev          | Issue | Finding                                                          | Action                                            |
| ------- | ------------ | ----- | ---------------------------------------------------------------- | ------------------------------------------------- |
| W2A     | 7 (blocking) | —     | `runPlugins` in `update.ts` unprotected after #320 made it throw | Fixed pre-merge: `handlePluginError` + `.catch()` |
| W2C     | 5            | #498  | `runCli` called before config saved                              | Filed                                             |
| W2C     | 4            | #499  | grace-log path overwrites on every run                           | Filed                                             |
| W2D     | 6            | #500  | `git status --porcelain` without `-z`                            | Filed                                             |
| W2D     | 4            | #501  | `indexOf(' -> ')` rename ambiguity                               | Filed                                             |
| W2D     | 3            | #502  | type guards check only shared fields                             | Filed                                             |
| W2B     | 6            | #503  | `basePackage` not validated                                      | Filed                                             |
| W2B     | 5            | #504  | `archetype` configure doesn't cascade derived fields             | Filed                                             |

---

## Worktrees

All 4 worktrees closed 2026-05-13 via `node dist/cli.js wt close NNN --force`
(squash-merge means branches don't register as merged in git).

---

## Issues Auto-Closed

Verified via `gh issue view N --json state`:

- #305 closed ✓ #306 closed ✓ #309 closed ✓ #310 closed ✓
- #311 closed ✓ #312 closed ✓ #317 closed ✓ #318 closed ✓
- #320 closed ✓ #322 closed ✓ #324 closed ✓ #325 closed ✓
- #326 closed ✓ #327 closed ✓

---

## Next

Wave 3 (W3A–W3D) — 4 parallel worktrees:

- W3A: #333 #334 #336 #337 #338 — probe.ts timeouts, kotlinc regex, CANON-10/14, renderTemplate types
- W3B: #350 #351 #355 #356 #357 — canon/01 dual-declination cluster
- W3C: #345 #347 #348 #352 #354 — canon/02 gate wiring
- W3D: #358 #359 #360 #379 — canon/02 misc (ephemeral-server, binary-size, awk-rust, audit script)
