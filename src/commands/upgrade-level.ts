// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GovernanceLevel } from '../wizard/types.js'
import { loadConfig, saveConfig } from '../utils/config.js'
import type { ArbiterConfig } from '../utils/config.js'
import { runCli } from '../utils/run-cli.js'
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

const LEVEL_RANK: Record<GovernanceLevel, number> = { L1: 1, L2: 2, L3: 3 }
const DEFAULT_GRACE_DAYS = 30

export function runUpgradeLevel(opts: UpgradeLevelOptions): void {
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
    handleExtend(dir, stored, opts.days ?? DEFAULT_GRACE_DAYS, opts.json)
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
  const graceEndsAt = new Date(Date.now() + days * 86400000).toISOString()

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

  runCli('node', ['scripts/capture-debt-baseline.mjs', '--update'], {
    cwd: dir,
  })

  saveConfig(dir, validation.config)

  if (opts.json) {
    jsonOutput('upgrade-level', 'ok', {
      from: current,
      to: target,
      graceEndsAt,
      graceDays: days,
    })
    return
  }

  const endsDate = graceEndsAt.slice(0, 10)
  if (current === 'L1' && target === 'L2') {
    console.log(t('cli.upgrade_level.grace_ends_warn', { date: endsDate, days, target }))
  } else {
    console.log(t('cli.upgrade_level.upgraded', { target, date: endsDate, days }))
    console.log(t('cli.upgrade_level.grace_warn_note', { target }))
  }
}

function handleExtend(
  dir: string,
  stored: ArbiterConfig,
  days: number,
  json: boolean | undefined,
): void {
  const existing = stored.graceEndsAt
  if (!existing || Date.parse(existing) <= Date.now()) {
    throw ArbiterError.fromKey(
      'E_NO_GRACE_PERIOD',
      'errors.E_NO_GRACE_PERIOD',
      {},
      { hint: 'Run `arbiter upgrade-level --target L2` to start a new grace period.' },
    )
  }

  const newEndsAt = new Date(Date.parse(existing) + days * 86400000).toISOString()

  const arbiterDir = join(dir, '.arbiter')
  if (!existsSync(arbiterDir)) {
    mkdirSync(arbiterDir, { recursive: true })
  }

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
  })

  writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n', 'utf-8')

  saveConfig(dir, { ...stored, graceEndsAt: newEndsAt })

  if (json) {
    jsonOutput('upgrade-level', 'ok', {
      action: 'extend',
      newEndsAt,
      extensionDays: days,
    })
    return
  }

  const endsDate = newEndsAt.slice(0, 10)
  console.log(t('cli.upgrade_level.grace_extended', { date: endsDate, days }))
}
