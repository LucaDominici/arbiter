// SPDX-License-Identifier: Apache-2.0
// #2431: wall-clock budgets for the cross-model external-seat fixtures, derived from the
// vitest pool size instead of pinned to a literal measured on an idle host.
//
// `crossModelReview.timeoutMs` is not a "how long may this take" preference — it is the
// WALL-CLOCK deadline `runCli` hands to every child the seat spawns (the codex CLI, then
// `node scripts/record-agent-return.mjs`). Miss it and `invokeExternalReview` reports
// `degraded`, which for a fixture asserting `fulfilled` reads as a contract violation
// rather than what it is: the host was too busy to let the seat answer in time. The
// fixtures were failing that way on a loaded 24-core box (#2431) with a correct assertion
// and a false premise, while passing 15/15 standalone.
//
// The premise is what has to hold, so it is computed rather than guessed. The suite already
// knows how many test files it runs at once — that is the contention it creates for itself —
// and `ciMaxWorkers()` in vitest.config.ts is the single source of truth for it (#2282).
// Deriving from the CONFIGURED pool size keeps the budget deterministic for a given run;
// deriving it from instantaneous host load would make the budget itself flaky.
import { availableParallelism } from 'node:os'
import { ciMaxWorkers } from '../../vitest.config'

/**
 * Ceiling for an uncontended (one-worker) pool: vitest.config.ts `testTimeout`. A fixture
 * whose seat budget sits BELOW its own harness ceiling can only convert a loud harness
 * timeout into a silent `degraded` — which is exactly the #2431 failure shape — so the
 * harness ceiling is the quantity that scales, and the seat budget is carved out of it.
 */
const BASE_HARNESS_TIMEOUT_MS = 30_000

/**
 * Hard cap. Scaling must not turn a genuinely hung seat into a run that stalls the suite
 * for as long as the pool is wide; 4 minutes is far past any real seat and still bounded.
 */
const MAX_HARNESS_TIMEOUT_MS = 240_000

/**
 * The seat spawns two sequential children inside one harness window (codex, then the
 * recorder). Dividing by three leaves each of them a full budget plus a third for the CLI
 * startup and ship pipeline around them, and guarantees the seat can never outlive the
 * harness that is timing it.
 */
const SEAT_CHILDREN_PER_HARNESS = 3

interface ExternalSeatBudgetOptions {
  /** Ceiling for a one-worker pool. Defaults to {@link BASE_HARNESS_TIMEOUT_MS}. */
  baseMs?: number
  /** Environment carrying `VITEST_MAX_WORKERS` / `CI`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Host parallelism. Defaults to `availableParallelism()`. */
  parallelism?: number
}

/** `VITEST_MAX_WORKERS` as vitest reads it: a count, or a percentage of host parallelism. */
function workersFromEnvOverride(raw: string, parallelism: number): number | undefined {
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim())
  if (percent) return Math.max(1, Math.round((parallelism * Number(percent[1])) / 100))
  const count = /^\d+$/.exec(raw.trim())
  return count ? Math.max(1, Number(count[0])) : undefined
}

/**
 * How many test files this run puts on the host at once — the contention the suite creates
 * for itself. `VITEST_MAX_WORKERS` wins because vitest itself honours it over any config;
 * `ciMaxWorkers()` is the CI cap both configs already apply; otherwise vitest's own default
 * sizing (`availableParallelism() - 1`).
 */
function effectiveWorkers(env: NodeJS.ProcessEnv, parallelism: number): number {
  const override = env.VITEST_MAX_WORKERS
  if (override !== undefined) {
    const parsed = workersFromEnvOverride(override, parallelism)
    if (parsed !== undefined) return parsed
  }
  return ciMaxWorkers(env) ?? Math.max(1, parallelism - 1)
}

/**
 * Wall-clock ceiling for whatever WRAPS an external seat — the `spawnSync` timeout on the
 * CLI under test and the per-test vitest timeout. Scales linearly with the pool size from
 * today's fixed `testTimeout`, so a wider pool buys proportionally more room and a
 * one-worker pool is unchanged.
 */
export function externalSeatHarnessTimeoutMs(options: ExternalSeatBudgetOptions = {}): number {
  const baseMs = options.baseMs ?? BASE_HARNESS_TIMEOUT_MS
  const parallelism = options.parallelism ?? availableParallelism()
  const workers = effectiveWorkers(options.env ?? process.env, parallelism)
  const cap = Math.max(baseMs, MAX_HARNESS_TIMEOUT_MS)
  return Math.max(baseMs, Math.min(cap, baseMs * workers))
}

/**
 * Per-child wall-clock budget for the external seat — the value a fixture puts in
 * `crossModelReview.timeoutMs`. Always strictly inside the harness ceiling derived from the
 * same options, so the budget is reachable and the scaling is not inert.
 */
export function externalSeatTimeoutMs(options: ExternalSeatBudgetOptions = {}): number {
  return Math.floor(externalSeatHarnessTimeoutMs(options) / SEAT_CHILDREN_PER_HARNESS)
}
