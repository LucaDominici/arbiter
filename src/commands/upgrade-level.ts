import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GovernanceLevel } from '../wizard/types.js'
import { loadConfig, saveConfig } from '../utils/config.js'
import type { ArbiterConfig } from '../utils/config.js'
import { runCli } from '../utils/run-cli.js'
import { jsonOutput } from '../utils/json-output.js'
import { validateConfig } from '../config/schema.js'

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
    throw new Error('No arbiter.json found. Run arbiter init first.')
  }

  if (opts.extend) {
    handleExtend(dir, stored, opts.days ?? DEFAULT_GRACE_DAYS, opts.json)
    return
  }

  if (!opts.target) {
    throw new Error('--target is required. Specify L2 or L3.')
  }
  const target = opts.target
  const current = stored.governanceLevel

  if (target === current) {
    throw new Error(`Already at ${current}. Nothing to upgrade.`)
  }

  if (LEVEL_RANK[target] < LEVEL_RANK[current]) {
    throw new Error('Downgrade not supported. Edit arbiter.json manually and run arbiter update.')
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
    throw new Error(`Config invalid after upgrade: ${validation.errors.join('; ')}`)
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
    console.log(`Grace ends ${endsDate} (${days} days). ${target} gates will WARN until then.`)
  } else {
    console.log(`Upgraded to ${target}. Grace period recorded until ${endsDate} (${days} days).`)
    console.log(
      `  Note: grace-period warn mode is L1→L2 only in this release; ${target} gates activate immediately.`,
    )
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
    throw new Error('No grace period to extend (none set or already expired).')
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
      throw new Error(`grace-log.json is malformed — delete ${logPath} to reset extend history`)
    }
    // #499: valid JSON that is not an array (e.g., a future schema object) is
    // also malformed for our purposes — silently overwriting it would erase
    // prior extend history. Refuse with the same recovery message.
    if (!Array.isArray(raw)) {
      throw new Error(`grace-log.json is malformed — delete ${logPath} to reset extend history`)
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
  console.log(`Grace extended to ${endsDate} (+${days} days).`)
}
