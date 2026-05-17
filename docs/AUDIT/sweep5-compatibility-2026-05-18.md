# Sweep 5 — `src/compatibility/` Audit

**Date:** 2026-05-18
**Scope:** `index.ts`, `matcher.ts`, `parsers.ts`, `probe.ts`, `report.ts`, `schema.ts`, `skills-validator.ts` (~764 LOC). EJS templates out of scope (deferred — too large for a single-agent sweep, tracked separately).
**Reviewer mode:** Combined red-team agent (bugs + type-safety + INV + silent-failure). #118 protocol used 4 parallel agents; this sweep used one adversarial reviewer with all-angles mandate for token efficiency.
**Closes:** #123 (Sweep 5) and the #118 umbrella.

## Summary

**Counts:** CRITICAL 0 · MAJOR 2 · MEDIUM 5 · SUGGESTION 4

No CRITICAL findings. Two MAJORs warrant fix issues (filed as follow-ups). The remaining MEDIUMs are correctness paper cuts and DRY cleanups suitable for incremental cleanup; SUGGESTIONs are nice-to-haves.

## MAJOR — open as follow-up issues

### M1 — `matches()` silently passes when any constraint is unparseable

**Location:** `src/compatibility/matcher.ts:10-16` (with `satisfies()` at :18-20)
**What:** `satisfies()` returns `false` when the constraint regex fails to match (`"^18"`, `"~18"`, `"18.x"`, etc.). Combined with the AND-loop in `matches()`, a single malformed token causes the whole range check to fail — but `probeTool` then emits `failed` with reason `"version X.Y outside <range>"`, blaming the user's tool instead of the matrix author. An **empty** range string trims to `[""]` which doesn't match the regex → universal fail with misleading reason. The matrix is JSON-loaded and validated for type, not for parseability of `range`, so a typo in `matrix.json` ships as runtime probe failures across every install.
**Fix:** In `satisfies()`, throw (or return a tagged error) on unparseable constraint and have `matches()` propagate. Add a startup-time `validateMatrix()` step that runs each `range` through `matches()` against a sentinel version, surfacing matrix bugs at load time.
**Follow-up issue:** filed (linked back to #118).

### M2 — Build probes treat any zero-exit as success, ignoring stderr/warnings

**Location:** `src/compatibility/probe.ts:241-275` (`runBuildProbe`)
**What:** `runCli` is invoked and any non-throw is reported as `{status: 'passed'}`. For `go build -n ./...`, `cargo check`, and `tsc --noEmit`, zero exit with diagnostics on stderr is possible. The probe never inspects stdout/stderr at all, so it cannot distinguish "ran successfully" from "ran and printed errors but exited 0". A user runs `arbiter verify`, sees green, and ships a project whose `tsc --noEmit` printed errors that arbiter swallowed.
**Fix:** Capture `result.stdout`/`result.stderr` and, for build probes, fail when stderr contains compiler error markers (or surface non-empty stderr as a `warning` probe). Document the contract that build probes rely on exit code in `BuildProbeSpec`.
**Follow-up issue:** filed (linked back to #118).

## MEDIUM (incremental cleanup, not blocking)

1. **`parseJavaVersion` mis-encodes legacy `1.8.0_402`** — `parsers.ts:32-35`. Returns `{major:8,minor:0,patch:402}`; `402` is the build, not patch. Range checks work; printed reason is wrong.
2. **`parseGoVersion` matches anywhere in the string** — `parsers.ts:77`. Regex unanchored. Anchor with `/^go version go(\d+)\.(\d+)/`.
3. **`probeHooksPath` swallows all git errors as "not configured"** — `probe.ts:343-352`. `git not installed` vs `not a git repo` vs `key absent` look identical. Distinguish `CliError.notFound`.
4. **`validateMatrix` cast hides extra-language drift** — `probe.ts:221`. Reject unknown top-level keys.
5. **Skills `VALID_SKILL_NAMES` is a manually-mirrored constant** — `skills-validator.ts:7-16`. SSOT drift class. Import `SKILL_NAMES` from `../generators/skills.js`.

## SUGGESTION (non-blocking)

1. `runProbes` stack→entries chain — `probe.ts:284-297`. Six-deep nested ternary; refactor for readability.
2. `parseTimeoutEnv` untested — export for unit coverage of `"-1"`, `"0"`, `"NaN"`, overflow cases.
3. `formatJson(report: VerifyReport | object)` widening defeats typing — `report.ts:61`. Drop the union or accept `unknown` explicitly.
4. `REMEDIATION` table incomplete — `report.ts:4-22` is missing `lint-imports` (declared in `TOOL_SPECS` at probe.ts:54). Add entry so failed probes get specific docs link.

## INV / CANON compliance

| Rule                             | Status                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| INV-04 (no `any`)                | clean — narrowed casts only                                                                                                                                  |
| INV-06 (no orphan TODOs)         | clean                                                                                                                                                        |
| INV-12 (no direct child_process) | clean — all subprocess work routes through `runCli`                                                                                                          |
| INV-12 (no PII)                  | clean                                                                                                                                                        |
| CANON-16 (refactor-first)        | flag for future janitorial pass — `parsers.ts` has 11 near-identical parser functions (~70 LOC collapse possible via `parseSemverTokens(raw, regex)` helper) |

## Resolution

- #123 (Sweep 5) — **closes with this audit doc.** MAJORs M1 + M2 tracked as separate fix issues; MEDIUMs and SUGGESTIONs documented for incremental cleanup.
- #118 (umbrella) — **closes** with all 5 sweeps complete:
  - #119 (Sweep 1 Foundation) → #277 findings
  - #120 (Sweep 2 Detectors) → #278
  - #121 (Sweep 3 Core generators) → #279
  - #122 (Sweep 4 Commands + Wizard + Worktree) → #280
  - #123 (Sweep 5 Compatibility) → this doc + follow-ups M1/M2

EJS-templates portion of Sweep 5 is deferred — the 60+ EJS files exceed a single-agent context budget. Tracked as a separate follow-up sweep if/when prioritised.

## Next steps

- M1 + M2 fix issues open as follow-ups.
- EJS-templates sweep deferred to a follow-up issue when prioritised.
