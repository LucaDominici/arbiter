---
title: 'arbiter Reuse Registry'
doc_version: '1.0.0'
status: active
last_review: '2026-05-21'
owner: ''
canonical_id: 'REUSE_REGISTRY'
tags: ['audience/dev', 'kind/method', 'scope/self']
related: ['REUSE_REGISTRY_SPEC', 'PATTERNS_CATALOG']
---

# arbiter Reuse Registry

**Purpose:** File-level registry of shared reusable modules. Consult before
creating any new file under `src/` or `scripts/` (CANON-16 survey).

**Spec:** `docs/METHOD/REUSE_REGISTRY_SPEC.md`

---

## Tier: scripts/lib

Shell-facing gate helpers. Used by `scripts/check-*.mjs` and CI entry points.

### log-bypass

- path: scripts/lib/log-bypass.mjs
- purpose: CLI wrapper around `checkBypass()` that signals bypass decisions via
  stderr and appends a JSONL record to the bypass audit log.
- key_exports: checkBypass
- when_to_use: any gate script that needs to honour an env-var bypass and must
  produce an auditable JSONL record of the decision.
- when_to_avoid: scripts where bypass is never permitted; use fail-closed logic
  directly instead.
- tests: indirect via `__tests__/scripts/check-*.test.ts`
- since: 0.1.0

### loud-bypass

- path: scripts/lib/loud-bypass.mjs
- purpose: Defensive contract for arbiter env-var bypass gates with deterministic
  truthy/falsy evaluation and JSONL audit logging.
- key_exports: loudBypass
- when_to_use: when a gate must be bypassable under a documented env var but
  every invocation must be loudly logged and the bypass must be auditable.
- when_to_avoid: gates where bypass is unconditionally forbidden; adds no value
  there and the extra JSONL record creates noise.
- tests: indirect via `__tests__/scripts/check-*.test.ts`
- since: 0.1.0

### parse-check-args

- path: scripts/lib/parse-check-args.mjs
- purpose: argv parser for `scripts/check-all.mjs` that maps subcommands and
  level aliases to check tiers (L1–L5).
- key_exports: SUBCOMMANDS
- when_to_use: any script that needs to parse `check-all`-style level arguments
  from `process.argv`.
- when_to_avoid: scripts with their own argument schema; use a dedicated arg
  parser (e.g. `parseArgs` from `node:util`) instead.
- tests: indirect via `__tests__/scripts/check-all.test.ts`
- since: 0.1.0

### run-helpers

- path: scripts/lib/run-helpers.mjs
- purpose: Gate runner trinity (`runCheck` / `runWarnCheck` / `runToolCheck`)
  with fail-closed semantics for CANON-01 gate scripts.
- key_exports: runCheck, runWarnCheck, runToolCheck
- when_to_use: any new gate script under `scripts/check-*.mjs`; enforces the
  fail-closed contract (non-zero exit propagates to caller).
- when_to_avoid: one-off scripts where the caller handles exit codes manually
  and does not need the fail-closed wrapper.
- tests: indirect via `__tests__/scripts/check-*.test.ts`
- since: 0.1.0

### suppressions-shared

- path: scripts/lib/suppressions-shared.mjs
- purpose: Shared validation helpers for suppression checkers; manages expiry
  dates, minimum reason length, and warning thresholds.
- key_exports: REASON_MIN_LEN, WARN_DAYS, checkExpiry
- when_to_use: any checker that validates inline or file-based suppressions and
  needs consistent expiry-date and reason-length enforcement.
- when_to_avoid: scripts that do not process suppression annotations.
- tests: indirect via `__tests__/scripts/check-suppressions.test.ts`
- since: 0.1.0

---

## Tier: src/utils

TypeScript utilities used across generators, commands, and the CLI core.

### canon-loader

- path: src/utils/canon-loader.ts
- purpose: Parse `docs/SYSTEM/CANON.md` into structured `CanonEntry` objects
  with numeric ID, title, and trigger condition.
- key_exports: CanonEntry, loadCanon
- when_to_use: any code that needs to enumerate or look up CANON-NN rules
  programmatically (e.g. plan-review rules, report generators).
- when_to_avoid: ad-hoc grep of the CANON file; use this loader for
  structured access.
- tests: `__tests__/utils/canon-loader.test.ts`
- since: 0.1.0

### channel

- path: src/utils/channel.ts
- purpose: Release channel resolution (latest/beta/canary) from CLI flags,
  config, or default, with stability ordering and validation.
- key_exports: ReleaseChannel, ResolvedChannel, CHANNEL_STABILITY, resolveChannel
- when_to_use: any command that accepts a `--channel` flag or needs to compare
  channel stability (e.g. downgrade detection).
- when_to_avoid: contexts where channel is hardcoded; no need to resolve
  dynamically.
- tests: `__tests__/utils/channel.test.ts`
- since: 0.1.0

### config

- path: src/utils/config.ts
- purpose: Load and validate `arbiter.json` with env-var overrides, schema
  migration, and feature-flag expansion.
- key_exports: ArbiterConfig, loadConfig, saveConfig
- when_to_use: any command or generator that needs the project's arbiter
  configuration.
- when_to_avoid: template rendering helpers where the config is already passed
  as a render context; do not load from disk again.
- tests: `__tests__/utils/config.test.ts`
- since: 0.1.0

### confirm-downgrade

- path: src/utils/confirm-downgrade.ts
- purpose: Prompt the user to confirm a release channel downgrade when the
  requested channel is less stable than the current config value.
- key_exports: confirmChannelDowngrade
- when_to_use: upgrade/set-channel commands that may decrease channel stability.
- when_to_avoid: non-interactive flows (CI, `--yes` flag); skip the prompt and
  proceed or reject based on policy.
- tests: `__tests__/utils/confirm-downgrade.test.ts`
- since: 0.1.0

### env

- path: src/utils/env.ts
- purpose: Canonical boolean parser for environment variables with consistent
  truthy/falsy evaluation across config layers.
- key_exports: isTruthy, isFalsy, parseEnvBoolean
- when_to_use: any code that reads `process.env` booleans and needs uniform
  semantics (`"1"`, `"true"`, `"yes"` are all truthy).
- when_to_avoid: non-boolean env vars; use `process.env` directly.
- tests: `__tests__/utils/env.test.ts`
- since: 0.1.0

### error-catalog

- path: src/utils/error-catalog.ts
- purpose: Structured catalog mapping error codes to summaries, detail text,
  recovery steps, and doc URLs for consistent user-facing errors.
- key_exports: ErrorEntry, ERROR_CATALOG
- when_to_use: throwing or displaying any named arbiter error; look up the code
  in the catalog rather than writing inline messages.
- when_to_avoid: transient internal errors with no user-facing recovery path.
- tests: `__tests__/utils/error-catalog.test.ts`
- since: 0.1.0

### errors

- path: src/utils/errors.ts
- purpose: `UserFacingError` class and `ArbiterError` union type for CLI error
  handling, user-visible message formatting, and error classification.
- key_exports: UserFacingError, ArbiterError, ArbiterErrorOptions
- when_to_use: throwing errors that surface to the CLI user with a formatted
  message and optional recovery hint.
- when_to_avoid: internal assertion errors where `Error` is sufficient and no
  user-facing text is needed.
- tests: `__tests__/utils/errors.test.ts`
- since: 0.1.0

### evidence-log

- path: src/utils/evidence-log.ts
- purpose: Schema and append-only logger for command execution evidence in
  `.arbiter/evidence/cmd-log.jsonl`.
- key_exports: EvidenceEntry, logEvidence
- when_to_use: any command that must produce an auditable record of its
  execution for the evidence harness.
- when_to_avoid: scripts outside the evidence-harness lifecycle; the log is
  only meaningful when the harness is active.
- tests: `__tests__/utils/evidence-log.test.ts`
- since: 0.1.0

### file-lock

- path: src/utils/file-lock.ts
- purpose: Atomic file lock using OS-level locking with automatic cleanup on
  process exit and collision detection for concurrent arbiter processes.
- key_exports: FileLock, acquireLock, releaseLock
- when_to_use: commands that must not run concurrently (e.g. code generation,
  config migration).
- when_to_avoid: read-only operations that tolerate concurrent access.
- tests: `__tests__/utils/file-lock.test.ts`
- since: 0.1.0

### first-run

- path: src/utils/first-run.ts
- purpose: First-run detection and privacy banner display using a
  `.arbiter/first-run-seen` marker file.
- key_exports: showFirstRunBanner, hasSeenFirstRun
- when_to_use: the CLI entry point to show the privacy notice exactly once.
- when_to_avoid: any context other than the top-level CLI bootstrap.
- tests: `__tests__/utils/first-run.test.ts`
- since: 0.1.0

### fs

- path: src/utils/fs.ts
- purpose: Atomic file write and rotation helpers with in-flight tracking and
  SIGTERM cleanup handlers.
- key_exports: writeFile, copyFile, rotateBackups
- when_to_use: generators and commands that write output files and need
  crash-safe atomicity.
- when_to_avoid: small throwaway writes where the overhead of tracking is
  not needed; use `node:fs` directly.
- tests: `__tests__/utils/fs.test.ts`
- since: 0.1.0

### json-output

- path: src/utils/json-output.ts
- purpose: Structured JSON envelope emitter for stdout with `status`, `errors`,
  `warnings`, and `data` fields.
- key_exports: JsonStatus, emitJson, statusToExitCode
- when_to_use: commands that support `--json` output and need a consistent
  machine-readable envelope.
- when_to_avoid: commands with no `--json` flag; write human-readable text
  directly.
- tests: `__tests__/utils/json-output.test.ts`
- since: 0.1.0

### logger-config

- path: src/utils/logger-config.ts
- purpose: Resolve logger level and format from CLI flags and env vars with
  fallback to defaults and validation warnings.
- key_exports: resolveLoggerConfig, LoggerConfigInputs
- when_to_use: CLI bootstrap before calling `getLogger()` to establish the
  log level and format for the session.
- when_to_avoid: after bootstrap; pass the resolved config to `getLogger()`
  rather than resolving repeatedly.
- tests: `__tests__/utils/logger-config.test.ts`
- since: 0.1.0

### logger

- path: src/utils/logger.ts
- purpose: Structured CLI logger singleton with `AsyncLocalStorage` scope for
  run-ID correlation and hybrid console/structured output.
- key_exports: Logger, getLogger, LogLevel, LogFormat
- when_to_use: all logging in commands, generators, and utils; use `getLogger()`
  rather than `console.log`.
- when_to_avoid: gate scripts under `scripts/` that run in a separate process
  and do not build against `src/`; use `process.stdout.write` there.
- tests: `__tests__/utils/logger.test.ts`
- since: 0.1.0

### maturity-check

- path: src/utils/maturity-check.ts
- purpose: Feature maturity matrix (proven/beta/unsafe/unavailable) for
  language and archetype combination validation.
- key_exports: MaturityLevel, MaturityFeature, checkMaturity
- when_to_use: wizard and generator entry points that must guard against
  unsupported language/archetype combinations.
- when_to_avoid: post-initialization code where the combination has already
  been validated.
- tests: `__tests__/utils/maturity-check.test.ts`
- since: 0.1.0

### perf

- path: src/utils/perf.ts
- purpose: Performance measurement utility computing p50/p95/p99 percentile
  stats over repeated synchronous or async iterations.
- key_exports: PercentileResult, measure
- when_to_use: benchmarks and profiling tests that need statistical percentile
  measurements.
- when_to_avoid: production code paths; measurement overhead is not negligible.
- tests: `__tests__/utils/perf.test.ts`
- since: 0.1.0

### platform

- path: src/utils/platform.ts
- purpose: Platform detection helpers for Windows and WSL2 environments.
- key_exports: isWindows, isWSL2
- when_to_use: code with platform-specific branches (path separators, shell
  invocation, symlink behaviour).
- when_to_avoid: code that is already portable and has no platform branches.
- tests: `__tests__/utils/platform.test.ts`
- since: 0.1.0

### plugin-loader

- path: src/utils/plugin-loader.ts
- purpose: Load and execute `ArbiterPlugin` instances in isolated Worker
  threads with timeout, validation, and structured error output.
- key_exports: LoadPluginOptions, loadPlugin
- when_to_use: the plugin subsystem entry point; do not spawn plugin workers
  directly.
- when_to_avoid: in-process plugin evaluation; all plugins run in workers for
  isolation.
- tests: `__tests__/utils/plugin-loader.test.ts`
- since: 0.1.0

### plugin-worker

- path: src/utils/plugin-worker.ts
- purpose: Worker thread entry point for plugin execution; injects template
  render context and relays results to the main thread.
- key_exports: (see source)
- when_to_use: not called directly; loaded by `plugin-loader.ts` as a worker
  thread.
- when_to_avoid: direct import from application code; use `loadPlugin` instead.
- tests: indirect via `__tests__/utils/plugin-loader.test.ts`
- since: 0.1.0

### prettier-format

- path: src/utils/prettier-format.ts
- purpose: Best-effort prettier wrapper that applies the target project's style
  config to generated files without failing on missing config.
- key_exports: formatWithPrettier
- when_to_use: generators and `post-edit-dispatch.mjs` hook to format emitted
  files to project style.
- when_to_avoid: arbiter's own source files; use `npx prettier` directly via
  npm scripts.
- tests: `__tests__/utils/prettier-format.test.ts`
- since: 0.1.0

### profiler

- path: src/utils/profiler.ts
- purpose: V8 CPU profiler wrapper for whole-process profiling from CLI entry
  to completion.
- key_exports: startProfiler, stopProfiler
- when_to_use: `--profile` flag in the CLI entry point to produce a CPU
  profile for debugging slow runs.
- when_to_avoid: production code paths or test suites; profiling is opt-in.
- tests: (see source)
- since: 0.1.0

### release-bucket

- path: src/utils/release-bucket.ts
- purpose: Four-way release tier bucket (`lib`/`service`/`cli`/`batch`)
  mapping archetypes to their publish job type.
- key_exports: ReleaseBucket, getReleaseBucket
- when_to_use: release workflow generators and maturity checks that need the
  publish tier for a given archetype.
- when_to_avoid: contexts where the archetype is unknown or the bucket is
  hardcoded in configuration.
- tests: `__tests__/utils/release-bucket.test.ts`
- since: 0.1.0

### render

- path: src/utils/render.ts
- purpose: EJS template renderer resolving template paths relative to
  `src/templates/` and injecting the standard render context.
- key_exports: renderTemplate
- when_to_use: any code that needs to render an EJS template from
  `src/templates/**/*.ejs`.
- when_to_avoid: ad-hoc `ejs.render()` calls; always go through
  `renderTemplate` so the context and path resolution are consistent.
- tests: `__tests__/utils/render.test.ts`
- since: 0.1.0

### replay

- path: src/utils/replay.ts
- purpose: Replay log capture for arbiter CLI runs with LRU rotation of
  `.arbiter/runs/` directories for post-hoc debugging.
- key_exports: captureReplay, loadReplayLog
- when_to_use: the CLI run harness to capture stdin/stdout/stderr of the
  current invocation for replay.
- when_to_avoid: commands that do not participate in the replay harness.
- tests: `__tests__/utils/replay.test.ts`
- since: 0.1.0

### run-cli

- path: src/utils/run-cli.ts
- purpose: Spawn subprocesses synchronously with retry logic, timeout, and
  structured error classification.
- key_exports: RunCliOptions, RunCliResult, runCli
- when_to_use: any code that needs to shell out to an external tool and wants
  retry, timeout, and typed error output.
- when_to_avoid: trivial one-shot spawns; `spawnSync` from `node:child_process`
  is lower overhead.
- tests: `__tests__/utils/run-cli.test.ts`
- since: 0.1.0

### run-id

- path: src/utils/run-id.ts
- purpose: Generate sortable IDs with prefix, timestamp, and hex nonce
  (`prefix-YYYYMMDD-HHMMSS-Nhex`), plus collision-free variants.
- key_exports: mintId, mintUniqueId
- when_to_use: any code that needs a unique, sortable, human-readable ID for
  run directories, evidence records, or audit logs.
- when_to_avoid: cryptographic key material; IDs are not securely random.
- tests: `__tests__/utils/run-id.test.ts`
- since: 0.1.0

### safe-read

- path: src/utils/safe-read.ts
- purpose: Safe file read with ENOENT distinction; returns empty string for
  missing files and surfaces other errors as warnings.
- key_exports: readFileSafe
- when_to_use: optional config or data files that may not exist, where the
  caller should tolerate absence gracefully.
- when_to_avoid: required files where absence is an error; use `readFileSync`
  directly and let it throw.
- tests: `__tests__/utils/safe-read.test.ts`
- since: 0.1.0

### seed

- path: src/utils/seed.ts
- purpose: Deterministic seeded RNG and clock for byte-identical generator
  output plus canonical JSON hashing.
- key_exports: SeededRng, seededClock, canonicalJsonHash
- when_to_use: generators and tests that need reproducible pseudo-random values
  without `Date.now()` or `Math.random()`.
- when_to_avoid: security-sensitive contexts; the RNG is deterministic, not
  cryptographic.
- tests: `__tests__/utils/seed.test.ts`
- since: 0.1.0

### vault-sync

- path: src/utils/vault-sync.ts
- purpose: Write vault files with `arbiter:generated` markers for idempotent
  emission and preservation of manual edits between regenerations.
- key_exports: writeVaultFile, updateVaultFile
- when_to_use: generators that emit files the user may edit and that must
  survive re-generation without overwriting changes.
- when_to_avoid: fully machine-owned files where overwrite-on-regenerate is
  the intended semantics; use `fs.writeFile` directly.
- tests: `__tests__/utils/vault-sync.test.ts`
- since: 0.1.0

---

## Tier: src/evidence

Evidence harness helpers consumed by the pre-push gate and TDD enforcement.

### git-checks

- path: src/evidence/git-checks.ts
- purpose: Git commit verification helpers that check whether a given SHA
  exists on the current branch.
- key_exports: shaExistsOnBranch
- when_to_use: evidence validators that need to confirm a recorded `test_commit_sha`
  is reachable from the current HEAD.
- when_to_avoid: contexts without git history (bare repos, CI shallow clones
  without `--unshallow`).
- tests: indirect via `__tests__/scripts/check-tdd-evidence.test.ts`
- since: 0.1.0

### load

- path: src/evidence/load.ts
- purpose: Load and parse evidence summary files with JSON validation and
  error recovery, returning typed `LoadSuccess` or `LoadFailure`.
- key_exports: LoadFailure, LoadSuccess, loadSummaryFile
- when_to_use: any gate or verify rule that reads `.arbiter/evidence/` files
  and needs typed, validated results.
- when_to_avoid: ad-hoc `JSON.parse` of evidence files; use this loader for
  consistent error handling.
- tests: `__tests__/evidence/load.test.ts`
- since: 0.1.0

### summary

- path: src/evidence/summary.ts
- purpose: Evidence summary validator that checks required fields (`head_sha`,
  `obs_gate`, `tests`, `coverage`, `mutation`, `security`).
- key_exports: verifySummary, REQUIRED_FIELDS
- when_to_use: the pre-push gate and CI evidence check to confirm the summary
  file is structurally complete.
- when_to_avoid: non-evidence contexts; the field set is specific to the
  summary schema.
- tests: `__tests__/evidence/summary.test.ts`
- since: 0.1.0

### tdd

- path: src/evidence/tdd.ts
- purpose: Zod schema for TDD evidence records capturing task ID, test path,
  commit SHA, failure log, and recording timestamp.
- key_exports: TddEvidenceV1, TddEvidence
- when_to_use: reading or writing `.arbiter/evidence/tdd/#NNN.json` files with
  validated types.
- when_to_avoid: non-TDD evidence files (use the relevant schema module
  instead).
- tests: indirect via `__tests__/scripts/check-tdd-evidence.test.ts`
- since: 0.1.0
