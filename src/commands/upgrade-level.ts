// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeFileTranslated } from '../utils/fs.js'
import { acquireLock } from '../utils/file-lock.js'
import type { GovernanceLevel } from '../wizard/types.js'
import { loadConfig, saveConfig } from '../utils/config.js'
import type { ArbiterConfig } from '../utils/config.js'
import { runCli } from '../utils/run-cli.js'
import { getLogger } from '../utils/logger.js'
import { jsonOutput } from '../utils/json-output.js'
import { validateConfig } from '../config/schema.js'
import { ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'

export interface UpgradeLevelOptions {
  dir?: string
  /** Required unless --extend is set. */
  target?: GovernanceLevel
  extend?: boolean
  days?: number
  json?: boolean | undefined
}

const LEVEL_RANK: Record<GovernanceLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 }
const DEFAULT_GRACE_DAYS = 30

/**
 * Hard ceiling on how far ahead of *now* a `graceEndsAt` may be persisted.
 *
 * This MUST stay in lock-step with `GRACE_MAX_DAYS` in
 * `src/templates/scripts/check-all.mjs.ejs`: the generated gate IGNORES any
 * `graceEndsAt` more than this many days ahead (it can no longer soften L2).
 * If the CLI wrote a larger window, the gate would silently disregard it and
 * the user would believe they had a longer grace than they actually do — a
 * confusing, fake-green-adjacent state. So the CLI clamps every write
 * (`--target ... --days N` and repeated `--extend`s) to this same bound, with
 * a loud warning, keeping `arbiter.json` truthful about what the gate honors.
 * (`check-all.test.ejs` parity test asserts the two constants are equal.)
 */
export const GRACE_MAX_DAYS = 35

/** Clamp an absolute end-of-grace timestamp to at most `now + GRACE_MAX_DAYS`. */
function clampGraceEndsAt(endsAtMs: number, nowMs: number): { ms: number; clamped: boolean } {
  const maxMs = nowMs + GRACE_MAX_DAYS * 86400000
  return endsAtMs > maxMs ? { ms: maxMs, clamped: true } : { ms: endsAtMs, clamped: false }
}

/**
 * Compute the persisted grace window for a fresh `--target` upgrade, clamped to
 * `GRACE_MAX_DAYS` (what the generated gate honors). Warns on STDERR when the
 * requested `--days` exceeds the bound and returns the effective (post-clamp)
 * day count so messaging/JSON never overstate the window.
 */
function resolveGraceWindow(
  days: number,
  nowMs: number,
): { graceEndsAt: string; effectiveDays: number } {
  const { ms, clamped } = clampGraceEndsAt(nowMs + days * 86400000, nowMs)
  if (clamped) {
    process.stderr.write(
      `${t('cli.upgrade_level.grace_capped', { max: GRACE_MAX_DAYS, requested: days })}\n`,
    )
  }
  return { graceEndsAt: new Date(ms).toISOString(), effectiveDays: clamped ? GRACE_MAX_DAYS : days }
}

/**
 * #1607: `--days` is the lone numeric flag that was never range-checked. A
 * non-integer (e.g. parseInt("abc")=NaN) reached `resolveGraceWindow` and threw
 * the opaque `RangeError: Invalid time value`; a value < 1 (`--days 0`/`-5`) was
 * accepted silently and persisted a now/past `graceEndsAt` — granting ZERO grace
 * against the new gates. Reject at this choke-point so both `--target` and
 * `--extend` (which reuse `opts.days`) are covered, including direct callers.
 */
function assertValidGraceDays(days: number | undefined): void {
  if (days !== undefined && (!Number.isInteger(days) || days < 1)) {
    throw new Error(
      `--days must be a positive integer (>= 1); got "${String(days)}". Example: --days 30.`,
    )
  }
}

/**
 * #1630: the debt-baseline script only exists at L2+ (emitted when enableDebtGates
 * is on). During the canonical L1→L2 upgrade the target project does NOT yet carry
 * it — it is generated later by the user's subsequent `arbiter update`. Running it
 * unconditionally aborted `runUpgradeLevel` with a raw MODULE_NOT_FOUND *before*
 * saveConfig, so the level never persisted on every freshly-generated consumer.
 * Guard existence + catch failures so a missing/failing baseline never blocks the
 * level bump (saveConfig still runs). Mirrors init.ts `runBrownfieldCapture`.
 */
function captureBaselineIfPresent(dir: string): void {
  const baselineScript = join(dir, 'scripts', 'capture-debt-baseline.mjs')
  if (!existsSync(baselineScript)) return
  try {
    runCli('node', ['scripts/capture-debt-baseline.mjs', '--update'], { cwd: dir })
    // #1630: re-raising would re-introduce the L1-consumer abort this guard fixes; the
    // failure is surfaced via logger.warn below and saveConfig still runs.
    // FAIL-OPEN-INTENT: a missing/failing debt-baseline must never block the level bump.
  } catch (err) {
    getLogger().warn(
      'upgrade_level.baseline_capture_failed',
      { err: err instanceof Error ? err.message : String(err) },
      'Baseline capture skipped/failed; re-run after `arbiter update`.',
    )
  }
}

export async function runUpgradeLevel(opts: UpgradeLevelOptions): Promise<void> {
  assertValidGraceDays(opts.days)

  const dir = resolve(opts.dir ?? '.')
  const stored = loadConfig(dir)

  if (!stored) {
    if (opts.json) {
      jsonOutput('upgrade-level', 'error', {}, ['No arbiter.json found. Run arbiter init first.'])
      process.exit(1)
      return
    }
    throw ArbiterError.fromKey(
      'E_CONFIG_NOT_FOUND',
      'errors.E_CONFIG_NOT_FOUND',
      {},
      {
        hint: 'Run `arbiter init` to initialize governance in this directory.',
        docUrl: 'https://arbiter.dev/reference/cli#init',
      },
    )
  }

  if (opts.extend) {
    await handleExtend(dir, stored, opts.days ?? DEFAULT_GRACE_DAYS, opts.json)
    return
  }

  if (!opts.target) {
    throw ArbiterError.fromKey(
      'E_TARGET_REQUIRED',
      'errors.E_TARGET_REQUIRED',
      {},
      {
        hint: 'Example: `arbiter upgrade-level --target L2`.',
      },
    )
  }
  const target = opts.target
  const current = stored.governanceLevel

  if (target === current) {
    throw ArbiterError.fromKey(
      'E_ALREADY_AT_LEVEL',
      'errors.E_ALREADY_AT_LEVEL',
      { level: current },
      {
        hint: 'Run `arbiter update` to regenerate governance files at the current level.',
      },
    )
  }

  if (LEVEL_RANK[target] < LEVEL_RANK[current]) {
    throw ArbiterError.fromKey(
      'E_DOWNGRADE_NOT_SUPPORTED',
      'errors.E_DOWNGRADE_NOT_SUPPORTED',
      {},
      {
        hint: 'Set `governanceLevel` in arbiter.json to the desired level, then run `arbiter update`.',
      },
    )
  }

  const days = opts.days ?? DEFAULT_GRACE_DAYS
  // Clamp + warn in one place; effectiveDays is what messaging/JSON must report
  // so the user is never told "9999 days" when only GRACE_MAX_DAYS were persisted.
  const { graceEndsAt, effectiveDays } = resolveGraceWindow(days, Date.now())

  // INV-33 (#498): validate config shape FIRST, then mutate external state,
  // then persist. Order is: validate → capture baseline → saveConfig. See
  // ADR-028. Previously runCli ran before validateConfig, so a validation
  // failure overwrote the debt baseline while arbiter.json stayed stale.
  const upgraded = { ...stored, governanceLevel: target, graceFromLevel: current, graceEndsAt }
  const validation = validateConfig(upgraded)
  if (!validation.ok) {
    throw ArbiterError.fromKey(
      'E_CONFIG_INVALID',
      'errors.E_UPGRADE_CONFIG_INVALID',
      { errors: validation.errors.join('; ') },
      { hint: 'Fix the errors above, or delete arbiter.json and re-run `arbiter init`.' },
    )
  }

  captureBaselineIfPresent(dir)

  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(dir, '.arbiter', '.lock'))
  try {
    await saveConfig(dir, validation.config)
  } finally {
    await lock.release()
  }

  if (opts.json) {
    jsonOutput('upgrade-level', 'ok', {
      from: current,
      to: target,
      graceEndsAt,
      graceDays: effectiveDays,
    })
    return
  }

  const endsDate = graceEndsAt.slice(0, 10)
  if (current === 'L1' && target === 'L2') {
    process.stdout.write(
      `${t('cli.upgrade_level.grace_ends_warn', { date: endsDate, days: effectiveDays, target })}\n`,
    )
  } else {
    process.stdout.write(
      `${t('cli.upgrade_level.upgraded', { target, date: endsDate, days: effectiveDays })}\n`,
    )
    process.stdout.write(`${t('cli.upgrade_level.grace_warn_note', { target })}\n`)
  }
}

async function handleExtend(
  dir: string,
  stored: ArbiterConfig,
  days: number,
  json: boolean | undefined,
): Promise<void> {
  const existing = stored.graceEndsAt
  if (!existing || Date.parse(existing) <= Date.now()) {
    throw ArbiterError.fromKey(
      'E_NO_GRACE_PERIOD',
      'errors.E_NO_GRACE_PERIOD',
      {},
      { hint: 'Run `arbiter upgrade-level --target L2` to start a new grace period.' },
    )
  }

  const _now = Date.now()
  const { ms: newEndsMs, clamped } = clampGraceEndsAt(Date.parse(existing) + days * 86400000, _now)
  if (clamped) {
    process.stderr.write(
      `${t('cli.upgrade_level.grace_extend_capped', { max: GRACE_MAX_DAYS, requested: days })}\n`,
    )
  }
  const newEndsAt = new Date(newEndsMs).toISOString()
  // Effective extension actually applied (post-clamp), rounded to whole days.
  // When clamped this is less than the requested `days`; reporting it keeps the
  // audit log and user messaging honest about the window that was persisted.
  const appliedDays = Math.round((newEndsMs - Date.parse(existing)) / 86400000)

  const arbiterDir = join(dir, '.arbiter')
  mkdirSync(arbiterDir, { recursive: true })

  const logPath = join(arbiterDir, 'grace-log.json')
  let log: unknown[] = []
  if (existsSync(logPath)) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(logPath, 'utf-8'))
    } catch {
      throw ArbiterError.fromKey(
        'E_GRACE_LOG_MALFORMED',
        'errors.E_GRACE_LOG_MALFORMED',
        { path: logPath },
        { hint: `Delete ${logPath} and retry.` },
      )
    }
    // #499: valid JSON that is not an array (e.g., a future schema object) is
    // also malformed for our purposes — silently overwriting it would erase
    // prior extend history. Refuse with the same recovery message.
    if (!Array.isArray(raw)) {
      throw ArbiterError.fromKey(
        'E_GRACE_LOG_MALFORMED',
        'errors.E_GRACE_LOG_MALFORMED',
        { path: logPath },
        { hint: `Delete ${logPath} and retry.` },
      )
    }
    log = raw
  }

  log.push({
    action: 'extend',
    at: new Date().toISOString(),
    previousEndsAt: existing,
    newEndsAt,
    days,
    ...(clamped ? { appliedDays, clampedToMaxDays: GRACE_MAX_DAYS } : {}),
  })

  const lock = await acquireLock(join(arbiterDir, '.lock'))
  try {
    writeFileTranslated(logPath, JSON.stringify(log, null, 2) + '\n')
    await saveConfig(dir, { ...stored, graceEndsAt: newEndsAt })
  } finally {
    await lock.release()
  }

  if (json) {
    jsonOutput('upgrade-level', 'ok', {
      action: 'extend',
      newEndsAt,
      extensionDays: appliedDays,
    })
    return
  }

  const endsDate = newEndsAt.slice(0, 10)
  process.stdout.write(
    `${t('cli.upgrade_level.grace_extended', { date: endsDate, days: appliedDays })}\n`,
  )
}
