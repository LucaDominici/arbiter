// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from './fs.js'
import { atomicWriteFile, withLock } from './atomic-write.js'
import { getLogger } from './logger.js'
import { ConfigError } from './errors.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import {
  type ArbiterConfigV2,
  type FeatureFlags,
  type ThresholdsV2,
  DEFAULT_THRESHOLDS,
  validateConfig,
} from '../config/schema.js'
import { migrate } from '../config/migrations/index.js'
import { applyEnvOverrides } from '../config/env-overrides.js'
import { rotateBackup } from '../state/backups.js'
import {
  SnapshotChecksumError,
  canonicalJson,
  wrapSnapshot,
  unwrapSnapshot,
} from '../state/envelope.js'
import { migrateState } from '../state/migrations/index.js'

export type { ArbiterConfigV2, FeatureFlags, ThresholdsV2 }
export type ArbiterConfig = ArbiterConfigV2

const CONFIG_FILE = 'arbiter.json'
const SNAPSHOT_FILE = '.arbiter-generated.json'

export async function saveConfig(dir: string, config: ArbiterConfig): Promise<void> {
  const lockDir = join(dir, '.arbiter')
  mkdirSync(lockDir, { recursive: true })
  await withLock(join(lockDir, 'kit.lock'), () =>
    atomicWriteFile(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n'),
  )
}

export function saveConfigAndSnapshot(dir: string, config: ArbiterConfig): void {
  const json = JSON.stringify(config, null, 2) + '\n'
  writeFile(join(dir, CONFIG_FILE), json)
  writeSnapshot(dir, config)
}

/**
 * Write only the snapshot envelope (`.arbiter-generated.json`) without
 * touching `arbiter.json`. Used by `arbiter doctor --repair-state` so
 * repair never clobbers the source-of-truth config (#619).
 */
export function writeSnapshot(dir: string, config: ArbiterConfig): void {
  const snapPath = join(dir, SNAPSHOT_FILE)
  rotateBackup(snapPath)
  const envelope = wrapSnapshot(config)
  writeFile(snapPath, canonicalJson(envelope) + '\n')
}

/**
 * Read `.arbiter-generated.json` and return the inner config.
 *
 * Behavior:
 *   - Missing file → null (legitimate, never raises).
 *   - Unreadable JSON → null + logger.warn (don't crash arbiter on garbage).
 *   - v0 (pre-envelope) snapshot → auto-migrated through config migrate(),
 *     returned without persisting (callers re-persist on next write).
 *   - v1 envelope with mismatched checksum → THROWS SnapshotChecksumError
 *     (#619 acceptance: hard error, no silent overwrite).
 *   - v1 envelope with valid checksum → unwrapped + run through config
 *     migrate() before return.
 */
export function loadSnapshot(dir: string): ArbiterConfig | null {
  const path = join(dir, SNAPSHOT_FILE)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_unreadable',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} is unreadable (${msg}) — delete the file to regenerate on next 'arbiter update'`,
    )
    return null
  }
  let inner: unknown
  try {
    const state = migrateState(raw)
    if (!state.migrated) {
      // v1 envelope on disk — verify checksum (HARD error on mismatch, #619).
      unwrapSnapshot(raw)
    }
    inner = state.envelope.config
  } catch (err) {
    if (err instanceof SnapshotChecksumError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_envelope_failed',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} failed envelope check (${msg}) — skipping snapshot`,
    )
    return null
  }
  try {
    return migrate(inner)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warn(
      'config.snapshot_migration_failed',
      { path, file: SNAPSHOT_FILE, err: msg },
      `${SNAPSHOT_FILE} at ${path} failed config migration (${msg}) — skipping snapshot`,
    )
    return null
  }
}

export function loadConfig(dir: string): ArbiterConfig | null {
  const path = join(dir, CONFIG_FILE)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      'E_CONFIG_INVALID',
      `arbiter.json at ${path} has invalid JSON: ${msg}. Fix or delete and re-run.`,
      { hint: 'Fix the JSON syntax or delete arbiter.json and run `arbiter init`.' },
    )
  }
  try {
    const migrated = migrate(raw)
    const withEnv = applyEnvOverrides(migrated, process.env)
    const validation = validateConfig(withEnv)
    if (!validation.ok) {
      throw new ConfigError(
        'E_CONFIG_INVALID',
        `arbiter.json at ${path} failed validation: ${validation.errors.join('; ')}. Fix or delete and re-run.`,
        {
          hint: 'Fix the configuration errors listed, or delete arbiter.json and run `arbiter init`.',
        },
      )
    }
    return validation.config
  } catch (err) {
    if (err instanceof ConfigError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      'E_CONFIG_INVALID',
      `arbiter.json at ${path} failed migration: ${msg}. Fix or delete and re-run.`,
    )
  }
}

export function defaultConfig(): ArbiterConfig {
  const governanceLevel = 'L2'
  return {
    version: '0.2',
    tools: ['claude', 'codex'],
    governanceLevel,
    permitGitHub: false,
    features: {
      debtGates: true,
      suppressions: true,
      securityScanning: true,
      mutationTesting: true,
      contractTesting: false,
      evidenceHarness: false,
      selfValidationHarness: true,
    },
    thresholds: DEFAULT_THRESHOLDS[governanceLevel],
    invariantTiers: presetToTiers(defaultPresetForLevel(governanceLevel)),
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    contractType: 'none',
  }
}
