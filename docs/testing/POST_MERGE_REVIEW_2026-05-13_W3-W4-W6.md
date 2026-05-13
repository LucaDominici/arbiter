# Post-Merge Review — Waves 3A/W1A/W6B/W4C — 2026-05-13

Continuation of the #277–#474 affinity-cluster execution after Wave 2.
Four PRs merged this session (10 issues closed), spanning W3A, W1A,
W6B, and W4C clusters.

---

## Clusters Merged

### W3A — #333 #334 #336 #337 #338 (PR #581)

**Issues:**

- #333 — `parseKotlinVersion` regex drops `^` anchor so real `info: kotlinc-jvm X.Y.Z` stderr matches. Rename `REMEDIATION['gradlew:help']` → `'gradlew:version'` for key alignment with `BUILD_PROBE_SPECS.java.name`.
- #334 — Env-driven probe timeouts (`ARBITER_PROBE_TIMEOUT_MS`, `ARBITER_BUILD_PROBE_TIMEOUT_MS`); synthetic `skipped` probe emitted when `detectLanguage` returns a stack outside the matrix ladder.
- #336 — CANON-10: `check-no-direct-spawn.mjs` row added to CLAUDE.md hooks table.
- #337 — CANON-14: `pre-edit-plan-anchor.mjs` + `pre-compact.mjs` rows added to CLAUDE.md hooks table.
- #338 — `renderTemplate`/`renderString`/`renderFromAbsPath` widened from `data: Record<string,unknown>` to `data: object`. Unblocked W4C (#304).

**Red-team filed:** 1 sev-5 follow-up (8 more undocumented hooks remain in CLAUDE.md — to be filed once GraphQL rate limit resets).

**Gate:** L2 green post-merge.

---

### W1A — #285 #286 (PR #582)

**Issues:**

- #285 — `generateClaudeSettings` always overwrites `.arbiter-backup` so the action label "backed-up-and-replaced" is truthful on every run. Previous `COPYFILE_EXCL` preserved the first-run backup forever and silently skipped subsequent backups.
- #286 — `mergeSettingsJson` now emits `console.warn` listing top-level keys whose incoming arbiter defaults were dropped because the user has a non-default value. No clobber; existing user values still preserved.

**Red-team:** 0 sev-≥7. 1 sev-3 (warn wording on malformed `hooks`/`permissions` shape — UX nit).

**Gate:** L2 green post-merge.

**Note (W1B/C/D):** All 12 remaining W1 issues (#287/#288/#289 + #283/#284/#291/#292 + #290/#293/#295/#296/#300) were verified already closed via prior work — no merges needed. Worktrees opened, verified-closed, closed.

---

### W6B — #473 #474 (PR #604)

**Issues:**

- #473 — `detectFramework(dir, 'multi')` previously dropped Java side and returned only the TS framework. Now detects both sides independently and returns either alone or a `tsFramework+javaFramework` composite (e.g. `express+spring-boot`) when both present. Java side considered absent unless `build.gradle` or `pom.xml` exists.
- #474 — `findExistingBoard` threads caller's `warnings[]` so `gh project list` failures surface to `ProjectBoardResult.warnings` instead of silently returning `null`. Removes duplicate-board risk on transient GH CLI failures.

**Red-team:** 0 sev-≥7. 1 sev-5: composite framework strings (e.g. `express+spring-boot`) have no entry in `FRAMEWORK_ARCHETYPE_MAP`, fall through to `LANGUAGE_FALLBACK_ARCHETYPE.get('multi') = 'backend-web-db'`. Pre-PR behavior was strictly worse (Java side dropped entirely). Follow-up issue to file.

**Gate:** L2 green post-merge.

---

### W4C — #304 (PR #625)

**Issue:**

- #304 — Systemic removal of `config as unknown as Record<string, unknown>` double-casts across 42 generator files. Unblocked by W3A's #338. Bulk sed-replaced 3 cast patterns (assignment, spread, terminal); internal helper signatures widened from `data: Record<string,unknown>` to `data: object`. 3 legitimate dynamic-access casts kept (`test-taxonomy.ts:16`, `config/diff.ts:138-139`).

**Result:** A renamed `ProjectConfig` field that isn't updated in the template now produces a TypeScript compile error at the call site instead of silently rendering `'undefined'` into generated files.

**Red-team:** 0 sev-≥7, 0 sev-≥5. 2 sev-3 polish items (4th legitimate cast in `configure.ts:133` not in 'kept' list; `mutation.ts:42` unnecessary `: object` annotation).

**Gate:** L2 green post-merge.

---

## Pre-Existing Failures Baseline

All 4 PRs accepted the same baseline established by W2 post-merge review:

```
plugin-loader.test.ts                 (4 tests)
example-plugin-spring-boot.test.ts    (3 tests)
```

Root cause: vitest's URL parsing chokes on `#` in worktree paths even
through `VITEST_ROOT` symlink, because plugin-loader uses dynamic
imports with absolute paths that bypass the symlink. Targeted tests
for each cluster's changes all pass.

---

## Issues Auto-Closed

Verified via `gh issue view N --json state`:

- #285 ✓ #286 ✓ #304 ✓ #333 ✓ #334 ✓ #336 ✓ #337 ✓ #338 ✓ #473 ✓ #474 ✓

Manually closed (verifiably already done in prior commits):

- #470 (soloDevMode + INV-53/54 — landed in commits 17663eb / 26c4512)

W1B/C/D children (#283 #284 #287 #288 #289 #290 #291 #292 #293 #295 #296 #300) were already closed by prior work — verified, no action needed.

---

## Deferred (out of session scope)

### W3B (#350 #351 #355 #356 #357), W3C (#345 #347 #348 #352 #354), W3D (#358 #359 #360 #379)

Each issue is a feature: new template family, render tests, integration
tests, CI wiring. Advisor flagged at session start that the 65%-saving
estimate of the affinity-clustering plan does not apply to these.
Recommended individual `/task` runs rather than 5-issue clusters.

### W4A (#349 #353)

Feature-sized: matrix row + new INV + new template + render test +
fixture (#349); template update + new lint check + L1 wiring (#353).

### W4B (#362 #363 #364 #365 #366)

F-cluster fixes for FAKE/HALF matrix cells. Blocked by user decision
issue #377 (matrix downgrade vs fix verdict) — implementation path
depends on this verdict.

### W5

Epics + decisions require user GO per item:

- #344 epic close (gated by W3B/C/D + W4A/W4B completion)
- #377 matrix downgrade vs fix verdict
- #378 user-toggle catalog decomposition
- #390 M33 Snapshot/Audit Pack decomposition
- #391 M34 Matrix Telemetry decomposition
- #399 v1.0 GA scope lock-in (overlaps #505–#580)

### W6A (#392 #393 #394 #395)

Superseded by v1 release plan #505–#580 (Apache 2.0 LICENSE in #505,
CoC in #507, examples gallery in #542). Recommend closing #392 and
#393 as duplicates after Apache vs MIT decision is confirmed.

---

## Session Stats

- **PRs merged:** 4 (5 if counting W3A which started in the prior Sonnet session)
- **Issues closed:** 11 (10 via PR merges + 1 manual #470)
- **Bonus closures:** 12 W1 children verified-closed (no merge needed)
- **Worktrees opened/closed:** 5 implementation worktrees + 3 empty W3 worktrees cleaned up
- **Red-team findings filed:** 0 sev-≥7 blocking across all 4 PRs

---

## Next Session

If continuing #277–#474 execution, recommended priority order:

1. **W4A** (#349, #353) — concrete features, no upstream gating
2. **#377 decision** — unblocks all of W4B
3. **W3B/W3C/W3D** — feature-by-feature individual `/task` runs
4. **W5 epics** — decompose with user input

---

## Session Continuation (2026-05-13 — 8 PRs total)

Continued after the W4C merge into the W3B small-fixes surface.
Additional PRs merged:

### #629 — W3B #355 — universal commit-msg regex (haben pattern)

`src/templates/githooks/commit-msg.ejs` enhanced with a two-layer
validation: a universal bash regex (no Node required) accepting all
11 `@commitlint/config-conventional` types plus `cluster` for
arbiter's batch-merge convention, with a `Merge `/`Revert ` bypass;
existing commitlint Layer 2 preserved for richer validation when
`npx` is available. Behavioral tests `spawnSync` the rendered hook
against representative messages with PATH stripped. Red-team
blocked the original 6-type regex (would reject 78% of arbiter's
own commits); the merged version follows conventional-commits +
arbiter conventions.

ADR-033 updated to reflect the cross-platform gap closure.

### #630 — W3B #350 — dogfood emitted gates (PII scan + debt ratchet)

`scripts/check-all.mjs` now invokes `scripts/pii-scan.mjs` (L1) and
`scripts/debt-report.mjs --gate` (L2). CANON-01 dogfood compliance.
Debt baseline recaptured to current state — historical regressions
(complexity 40→58, publicApiSurface 470→604) become the new floor;
future debt regressions block the gate.

Red-team blocked two sev-7 issues fixed pre-merge:

1. STRIDE/RACI traceability was initially wired but the STRIDE.md /
   RACI.md tables have zero HIGH/CRITICAL rows, so the script
   exited 0 unconditionally — a CANON-09 lie. STRIDE wiring removed
   from this PR; #631 filed to wire after threat rows exist.
2. PII allowlist `__tests__/` entry used `String.includes` match
   which would leak into `src/templates/__tests__/*` — templates
   shipped into every generated project. Matcher switched to
   anchored prefix (`rel === entry.file || rel.startsWith(entry.file)`).

Side-effect fixes: `pii-scan.mjs` SKIP_EXTENSIONS extended to
common compiled binaries (.so/.dll/.dylib/.a/.o/.class/.jar/.pyc/
.pyo/.exe/.node) which embed package-author metadata.

### #632 — W3B #357 — CI workflow concurrency block

`src/templates/github/workflows/ci.yml.ejs` gains a top-level
concurrency block (`group: ci-${{ github.ref }}`, cancel-in-progress
on non-main refs only). The `ci-required` aggregator job already
existed with proper conditional needs and `if: always()` re-check
loop, only the concurrency block was missing from the haben pattern.
Self-applied to arbiter's own `.github/workflows/ci.yml`.

### #633 — partial W3A #353 — vitest thresholdAutoUpdate:false

Generated `vitest.config.ts` now sets `thresholdAutoUpdate:false`
so coverage regressions stay visible until an operator explicitly
edits the threshold. Remaining acceptance criteria for #353
(coverage-excludes-rationale lint + L1 wiring) deferred — issue
stays open.

### Hygiene closures

- #470 (soloDevMode + INV-53/54) — verifiably done in prior commits
  17663eb / 26c4512.
- #379 (CANON-02 audit script) — already implemented as
  `scripts/check-matrix-proven-cells.mjs` (INV-47) wired at
  `scripts/check-all.mjs:134`. CANON-02 enforcement is machine,
  not prose.

### Follow-up issues filed

- #627 — 8 remaining undocumented hooks in CLAUDE.md (CANON-10)
- #628 — composite framework strings have no archetype mapping
- #631 — wire STRIDE/RACI gate once threat rows exist

### Updated session stats

- **PRs merged:** 8 (W3A, W1A, W6B, W4C, #355, #350, #357, #353-partial)
- **Issues fully closed via PR:** 14 (#285, #286, #304, #333, #334,
  #336, #337, #338, #350, #355, #357, #473, #474, ... and prior W3A)
- **Issues partially merged (still open):** #353 (thresholdAutoUpdate
  done; lint + L1 wiring deferred)
- **Manual closes:** #470, #379
- **Verified-closed via prior work:** W1B/C/D 12 issues
- **Red-team follow-ups filed:** #627, #628, #631

### Remaining open in #277–#474

Feature-sized work that requires per-issue `/task` treatment, not
the affinity-cluster protocol:

- W3 features still open: #347 (mutation wiring), #348 (pytest-
  playwright — half-wired for TS), #349 (a11y matrix), #351 (helper
  trinity), #352 (stylelint template), #354 (tarpaulin.toml template
  — gate wiring already done), #356 (docs-check rebased-aware
  template), #358 (ephemeral-server), #359 (binary-size), #360
  (awk-rust)
- W3 partial: #353 (remaining lint check)
- W4B (5 F-cluster issues, blocked by user decision #377)
- W5 epics + decisions (need user GO)
- W6A (#392–#395) — superseded by v1 release plan #505–#580
