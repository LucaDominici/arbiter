# Plan — #2197/#2209/#2204/#2205 — enforcement integrity ("a gate that cannot go red is worse than no gate")

Branch: `task/#2197-enforcement-integrity` · Base: main @ 583cf578

## Existing Code Survey

No new `src/` file is created by this batch. Every change extends an existing
module/evaluator:

- `#2197` — the emission record already exists: `.arbiter-generated-manifest.json`
  (`src/state/generated-manifest.ts`, written on every init/update). Verified on
  `examples/ts-library/.arbiter-generated-manifest.json`: keys are plain
  targetDir-relative posix paths (`eslint.config.static.mjs`,
  `scripts/check-doc-set.mjs`, `scripts/conformance.mjs`) — byte-identical to the
  literals the emitted `check-all.mjs` passes to `existsSync`. Result recording
  already exists: `pushResult(name, status, elapsed)` in both
  `scripts/lib/run-helpers.mjs` and `src/templates/scripts/lib/run-helpers.mjs.ejs`.
  → extend the emitted gate with one helper; no new script, no new manifest.
- `#2209` — the substance-predicate pattern already exists in the same registry
  (`version_consistency` → `evalVersionConsistency`). The change is inside the
  existing `evalFileExists` evaluator (two parity twins), no new check type.
- `#2204` — `phaseGates` in `src/commands/task.ts` already exists with two entries;
  the gate-pass marker shape is already produced by `check-all.mjs` and already
  validated by `.claude/hooks/enforce-gate-before-pr.mjs` (head_sha/branch).
  Bypass env `ARBITER_SKIP_GATE_MARKER` already registered in
  `src/config/env-registry.ts` — reused, no new env concept.
- `#2205` — `captureTestOutput` / `FAILURE_SIGNATURES` already exist; the change is a
  refusal branch + one regex, mirrored into the emitted hand-copy.

## Files manifest

- `src/templates/scripts/check-all.mjs.ejs` (#2197, emitted track)
- `scripts/check-all.mjs` (#2197, self track)
- `scripts/lib/gold-audit-lib.mjs` + `src/conformance/engine.ts` (#2209, parity twins)
- `standards/gold-registry.yml`, `src/templates/standards/gold-registry.yml.ejs` (#2209, only if a
  substance arg is needed)
- `src/commands/task.ts` (#2204)
- `src/commands/task-record-red.ts`, `src/evidence/tdd.ts`,
  `src/templates/scripts/check-tdd-evidence.mjs.ejs` (#2205)
- new tests under `__tests__/` (4 red tests) + existing test/golden-master updates
  (rendered check-all golden master, gold-audit baselines, task-advance tests)

## Frozen acceptance criteria

### AC-2197
1. A rendered target `check-all.mjs` whose `.arbiter-generated-manifest.json` LISTS a guard
   config/script that is MISSING on disk exits non-zero and names the missing file.
2. The same rendered gate with the same file NEVER emitted (absent from the manifest) still
   SKIPs and exits 0 — legitimately-optional checks are not broken.
3. Manifest absent ⇒ loud degraded line (distinct from the never-emitted SKIP text).
4. `gate-pass.json` is not stamped when (1) fires (the run FAILs).
5. Arbiter's own `scripts/check-all.mjs` has no `existsSync`-gated `runCheck` on a committed
   arbiter-owned script.

### AC-2209
1. A zero-byte / whitespace-only file scores `P` (never `Y`) for a `file_exists` check, with
   evidence naming emptiness.
2. Verdict parity holds between `scripts/lib/gold-audit-lib.mjs` and `src/conformance/engine.ts`
   (`engine-parity.test.ts` green).
3. The `applies_if` precondition `file_exists` keeps pure-existence semantics (unchanged).
4. arbiter's own gold-audit score does not regress (no honest check flips Y→P).

### AC-2204
1. `task advance --to verification|close|complete` throws when `.arbiter/gate-pass.json` is
   absent, or its `head_sha`/`branch` do not correlate to the current HEAD/branch.
2. The phase is NOT mutated when the gate throws (no partial advance).
3. A fresh correlated marker lets the transition succeed.
4. `ARBITER_SKIP_GATE_MARKER=1` bypasses (registered, loud).

### AC-2205
1. `record-red` refuses when the runner exits 0 (green run), regardless of any failure
   signature in the log.
2. A failing `node:test`/TAP run is classified failing (`# fail N` summary) in both
   `src/evidence/tdd.ts` and the emitted `check-tdd-evidence.mjs`.
3. A launch failure / timeout is still reported as a launch failure, never as RED evidence.

## Out of scope (recorded, not fixed here)

- `doctor fail-open-census` does not census the JS `if (existsSync(x)) run() else SKIP` twin
  (only the shell `command -v X ||` form) — separate detector, captured via `arbiter note`.
- "Four changelog lines give L3/100": an emptiness predicate cannot judge changelog substance;
  unbounded heuristics rejected. Residual recorded in the report.
