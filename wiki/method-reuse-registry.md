---
generated: true
source: 'docs/METHOD/REUSE_REGISTRY.md'
source_sha: 'e46d1f1e8435df36f12188137a5696ac8137e3fb'
last_updated: '2026-06-07'
---

# arbiter Reuse Registry

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/REUSE_REGISTRY.md](../docs/METHOD/REUSE_REGISTRY.md)

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
- when_to_avoid: any contex

_[content truncated — see source for full text]_

## See Also

- [[method-reuse-registry]] — related
- [[method-patterns-catalog]] — related
