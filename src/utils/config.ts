// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import {
  type ArbiterConfigV2,
  type FeatureFlags,
  type ThresholdsV2,
  DEFAULT_THRESHOLDS,
} from '../config/schema.js'
import { migrate } from '../config/migrations/index.js'
import { applyEnvOverrides } from '../config/env-overrides.js'

export type { ArbiterConfigV2, FeatureFlags, ThresholdsV2 }
export type ArbiterConfig = ArbiterConfigV2

const CONFIG_FILE = 'arbiter.json'
const SNAPSHOT_FILE = '.arbiter-generated.json'

export function saveConfig(dir: string, config: ArbiterConfig): void {
  const path = join(dir, CONFIG_FILE)
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function saveSnapshot(dir: string, config: ArbiterConfig): void {
  const path = join(dir, SNAPSHOT_FILE)
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function loadSnapshot(dir: string): ArbiterConfig | null {
  const path = join(dir, SNAPSHOT_FILE)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[arbiter] ${SNAPSHOT_FILE} at ${path} is unreadable (${msg}) — ` +
        `delete the file to regenerate on next 'arbiter update'`,
    )
    return null
  }
  // Route the snapshot through the same migration chain as loadConfig so a stale
  // pre-v2 snapshot doesn't satisfy the type at compile time and crash at runtime
  // when later code touches v2-only fields (#277 finding #7).
  try {
    return migrate(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[arbiter] ${SNAPSHOT_FILE} at ${path} failed migration (${msg}) — skipping snapshot`,
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
    console.warn(`[arbiter] arbiter.json at ${path} has invalid JSON (${msg}) — ignoring`)
    return null
  }
  try {
    const migrated = migrate(raw)
    return applyEnvOverrides(migrated, process.env)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[arbiter] arbiter.json at ${path} failed migration (${msg}) — ignoring`)
    return null
  }
}

export function defaultConfig(): ArbiterConfig {
  const governanceLevel = 'L2'
  return {
    version: '0.2',
    tools: ['claude', 'codex'],
    governanceLevel,
    useGitHub: false,
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
