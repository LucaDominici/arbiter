# ADR-002 — Exit code propagation from `gh` failures (and other recoverable errors)

> **Status**: Draft (Claude) · **Date**: 2026-05-26 · **Reviewer**: Luca
> **Maps to**: Wave 0 finding **F9** (exit 0 despite ~25 errors)
> **Evidence**: [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §F9 · [`../wave0/evidence/haben-update-1st.txt`](../wave0/evidence/haben-update-1st.txt) tail

## Problem

`arbiter update` exits **0** while printing `Error: …` and `Skipped (requires admin access): …` for ~25 failed `gh` calls. A CI wrapper of the form `arbiter update && next-step` is structurally blind to provisioning failures. For a tool whose value proposition is enforcement, the gate-around-arbiter is broken.

The same pattern likely exists elsewhere (any try/catch that prints `Error:` then continues). Fix the policy globally, not just for `gh`.

## Code anchors

- `src/commands/update.ts` — the main loop that gathers gh results into the `Error: …` lines
- `src/github/project-board.ts` — `gh project` wrappers that catch and stringify errors
- `src/utils/*` — likely a `runGh()` or `execSafe()` helper that returns instead of throws

Grep targets in chat: `catch.*console.log\|catch.*console.error`, `swallow`, `\.catch\(`, `try\s*\{[\s\S]*?gh\s`.

## Options considered

**Option A — Fail fast (first error → exit 1)**
- Simplest. First gh failure halts execution.
- Pro: matches POSIX expectations.
- Con: partial provisioning. A failing `gh label create` doesn't stop the broader project setup; failing fast leaves the repo half-configured. Not great UX.

**Option B — Aggregate + non-zero exit (RECOMMENDED)**
- Continue through all non-fatal errors, collect them into an `errors[]` array, print summary at the end, exit non-zero if `errors.length > 0`.
- Pro: best of both: user sees the full picture in one run, CI gets an honest exit code.
- Con: need to classify "fatal" vs "non-fatal" so a missing auth (fatal) doesn't keep barreling.

**Option C — Tiered exit codes**
- `0` = clean, `1` = recoverable errors (e.g., gh label create that label already exists), `2` = unrecoverable (auth, network, permissions).
- Pro: most informative. CI can `case $? in 0|1) continue;; *) abort;;`.
- Con: more API surface to document; needs a clear taxonomy.

## Recommended: Option B with light tiering

Mainline: Option B (aggregate + non-zero). Reserve a single sentinel `exit 78` for "config error, no work attempted" (per POSIX `EX_CONFIG`), so wrappers can distinguish "tried and partially failed" (exit 1) from "didn't start" (exit 78).

Concrete contract:
- `exit 0` — all attempted operations succeeded
- `exit 1` — one or more non-fatal operations failed (gh label exists, network blip on label create, etc.). Stdout/stderr lists which.
- `exit 78` — config invalid; nothing attempted (preserve via `EX_CONFIG`).
- `exit 2` — fatal during operation (gh auth lost mid-run, fs write denied). Halts immediately, no aggregation.

### Error classification

Build in `src/utils/error-classes.ts` (or extend if exists):

```ts
export class RecoverableError extends Error { kind: 'recoverable' = 'recoverable' }
export class FatalError extends Error { kind: 'fatal' = 'fatal' }
export class ConfigError extends Error { kind: 'config' = 'config' }
```

The gh wrapper throws `RecoverableError` for label-already-exists, branch-protection-no-admin (404/403 expected); `FatalError` for auth-missing, rate-limit-hit. The main loop catches by class, aggregates `RecoverableError`s, lets `FatalError` propagate.

## Test plan

- Unit: `__tests__/cli/exit-codes.test.ts` — drive `arbiter update` with stubs that throw each error class, assert exit code matches matrix.
- Integration: real `arbiter update` on a repo with `--github` but bogus credentials → expect exit 2.
- Regression: re-run Wave 0 fixture, confirm exit code is 1 (not 0) when label calls fail.

## File impact survey

| File | Change |
|---|---|
| `src/utils/error-classes.ts` | New file or extend existing taxonomy |
| `src/commands/update.ts` | Wrap main loop; aggregate errors; exit code mapping |
| `src/commands/init.ts` | Same |
| `src/github/project-board.ts` | Throw `RecoverableError` instead of catch+log |
| `src/github/<gh wrappers>` | Same pattern, library-wide |
| `__tests__/cli/exit-codes.test.ts` | New |

CANON-16 survey: search for current `console.error('Error:')` / `console.log('Error:')` patterns across `src/`, list count, ensure consistent migration. If there are >10 sites, do a small refactor of the `gh` wrapper to centralize the catch.

## Acceptance criteria

- [ ] `arbiter update` on a repo with `--github` and 5 failed label calls exits `1`, with summary `5 recoverable errors`
- [ ] `arbiter update` without `gh` auth exits `2` mid-way with clear message
- [ ] `arbiter update` with malformed `.arbiter.json` exits `78` before any work
- [ ] No `console.log('Error: …')` followed by `return undefined` patterns remain in `src/github/`
- [ ] CHANGELOG entry under `[Unreleased] Behavior` documenting new exit codes
- [ ] L1 + L2 green

## Open questions

1. Is there an existing error class taxonomy in `src/utils/`? Survey first.
2. Should we add a `--strict` flag that escalates recoverable → fatal? Cheap to add; useful for paranoid CIs.
3. Does the `--json` output mode (e.g. `arbiter diff --json`) also encode the error class? Should it? Probably yes — JSON consumers benefit most.
