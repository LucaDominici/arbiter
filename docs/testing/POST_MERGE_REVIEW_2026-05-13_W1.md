# Post-Merge Review — Wave 1 (W1 Generator-Side Cluster)

**Date:** 2026-05-13
**PRs merged:** #482 (W1A), #490 (W1B), #489 (W1C), #488 (W1D), #493 (hotfix)
**Issues closed:** #285, #286, #287, #288, #289, #283, #284, #291, #292, #290, #293, #295, #296, #300
**Hotfix:** #493 — repaired 2 test regressions introduced by W1 merges

---

## Cluster Summary

Wave 1 was the generator-side cluster — four parallel worktrees covering claude.ts settings merge, contract-testing gates, archunit/suppressions scope, and silent-failure fixes. All four clusters ran red-team review; blocking findings fixed before merge.

---

## Issue Outcomes

### W1A — #285 #286 (`claude.ts` + `mergeSettingsJson`)

**#285**: `copyFileSync(settingsPath, backupPath, constants.COPYFILE_EXCL)` — backup now uses EXCL flag so first-ever backup is never overwritten on subsequent runs. Imports `constants` from `node:fs`.

**#286**: `KNOWN_SETTINGS_KEYS` warn loop removed entirely. The warn was misleading — `mergeSettingsJson` already preserves ALL keys (no dropping). JSDoc updated to accurately describe preserve-all behavior.

**Red-team finding fixed before merge:** COPYFILE_EXCL semantics verified: first backup protected, subsequent runs skip (no accidental overwrite).

### W1B — #287 #288 #289 (`contract-testing.ts`)

**#289**: `if (!config.hasPublicApi) return { files: [] }` guard at top — skips generator entirely when public API is absent.

**#288**: `isL3Allowed(language, 'contract', acceptBetaTools)` gate for Rust/Go/Python — beta-tool guard.

**#287**: Unknown `contractType` now emits `console.warn('[contract-testing] Unknown contractType: ... — skipping')` and returns `{ files: [] }` instead of throwing. Critical: `safeRun()` wraps generators and swallows throws (issue #483); warn+return matches project convention established by #294.

**Red-team blocking finding fixed:** Isolation test strengthened — added `hasPublicApi: true, acceptBetaTools: true` to the rust test so it exercises dispatch logic, not just the early-return guard.

### W1C — #283 #284 #291 #292 (`archunit.ts` + `suppressions.ts`)

**#283**: `if (config.basePackage)` guard before `NoMockMvcTest.java` emission — prevents generation when base package unknown.

**#284**: `&& config.basePackage` guard on `ArchitectureTest.java` for layered/modular-monolith archetypes.

**#291**: RestAssured block moved out of `emitHexagonalSuite` to top-level — applies to all archetypes when `hasDatabase && hasPublicApi`. Gateway broadened: `architectureStyle !== 'none'` in `check-all.mjs.ejs`. Maven section added for parallel architecture test invocation.

**#292**: `archunit-baseline.json` guarded on `config.language === 'java'` — not emitted for TypeScript/Rust/Go/Python.

**Red-team blocking finding fixed:** `check-all.mjs.ejs` gate was still checking `architectureStyle === 'hexagonal'` while generator now emits for all non-none archetypes. Changed to `architectureStyle !== 'none'`. Maven section added.

Additional filed: **#491** (RestAssured templates assume Spring Boot — needs framework guard), filed for future cluster.

### W1D — #290 #293 #295 #296 #300 (silent-failure fixes)

**#290**: `stride-enforcement.ts` — early return `{ files: [] }` when `config.governanceLevel === 'L1'`.

**#293**: nightly/evidence/debt-ratchet trio verified functional (no regression, no changes needed — spec already correct).

**#295**: gemini/windsurf/aider wired into `buildAiToolSpecs` in `registry.ts`; `GeneratorKey` union extended in `src/config/diff.ts`.

**#296**: `JSON.parse(...) as X` replaced with `unknown` + runtime narrowing in `labels.ts` and `project-board.ts`.

**#300**: `renderSecurityTemplate()` wrapper in `security.ts` — try/catch with `{ cause: err }`, re-throws as `security.ts: template not found...` with actionable message.

**Red-team blocking findings fixed:** `#296` narrowing verified; `findExistingBoard` validation gaps filed as **#492** (validation errors swallowed by bare catch — future cluster).

---

## Hotfix — #493

Two test regressions from W1 merges:

1. **`suppressions.test.ts:86`**: Java file count assertion was stale (`7`); actual output is `9` after W1B/C added archunit-baseline + owasp-suppressions + trivyignore. Updated to `9`.

2. **`security.test.ts`**: `require('../../src/utils/render.js')` inside test body fails in ESM vitest. Moved the describe block to `__tests__/integration/security-template-error.test.ts` using top-level `vi.mock()` (vitest hoists it) + `vi.mocked().mockImplementationOnce()`. Auto-mock wraps all exports in `vi.fn()` — `mockImplementationOnce` then works.

---

## Red-Team Findings — W1 Wave

| Finding                                                          | Severity   | Cluster | Action                                     |
| ---------------------------------------------------------------- | ---------- | ------- | ------------------------------------------ |
| throw on unknown contractType swallowed by safeRun               | 7 (HIGH)   | W1B     | Fixed before merge — warn+return           |
| Isolation test exercises wrong path (rust guard not dispatch)    | 7 (HIGH)   | W1B     | Fixed before merge — beefed isolation test |
| gate not broadened after RestAssured scope change                | 7 (HIGH)   | W1C     | Fixed before merge — `!== 'none'` + Maven  |
| COPYFILE_EXCL semantics risk (first backup could be overwritten) | 5 (MEDIUM) | W1A     | Fixed before merge — EXCL enforced         |
| RestAssured templates assume Spring Boot (no framework guard)    | 5 (MEDIUM) | W1C     | Filed #491, future cluster                 |
| findExistingBoard validation swallowed by bare catch             | 6 (HIGH)   | W1D     | Filed #492, future cluster                 |

---

## GH Issues Filed From Red-Team (W0 retroactive + W1)

- **#483**: safeRun() exits 0 when generators fail (8/10 HIGH) — future W3/W4 cluster
- **#484**: `||` fallback overrides explicit `0` config (6/10 MEDIUM) — future cluster
- **#485**: parity check one-directional (4/10 MEDIUM) — backlog
- **#486**: multi-line title regex apostrophe issue (5/10 MEDIUM) — backlog
- **#487**: integration-testing gate clarification (4/10 MEDIUM) — backlog
- **#491**: RestAssured templates assume Spring Boot (5/10 MEDIUM) — future cluster
- **#492**: findExistingBoard validation errors swallowed (6/10 HIGH) — future cluster

---

## No-verify Audit

All W1 commits used `--no-verify`. Authorized per AGENTS.md §Enforcement Chain.

Pre-existing failures: `plugin-loader.test.ts` (4) and `example-plugin-spring-boot.test.ts` (2) — identical failures before any changes (# path encoding issue in worktrees).

---

## Gate Status (main after hotfix merge)

`node scripts/check-all.mjs L2` — **ALL PASSED** on main after #493.

Wave 2 unblocked.
