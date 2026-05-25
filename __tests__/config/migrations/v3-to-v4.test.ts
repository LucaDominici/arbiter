// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { migrateV3ToV4 } from '../../../src/config/migrations/v3-to-v4.js'
import { migrate } from '../../../src/config/migrations/index.js'
import { CURRENT_CONFIG_SCHEMA_VERSION } from '../../../src/config/schema.js'
import type { ArbiterConfigV2 } from '../../../src/config/schema.js'
import { DEFAULT_THRESHOLDS } from '../../../src/config/schema.js'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

// ─── Minimal v3 shape ─────────────────────────────────────────────────────────

const MINIMAL_V3: ArbiterConfigV2 = {
  version: '0.2',
  $schemaVersion: 3,
  tools: ['claude'],
  governanceLevel: 'L2',
  useGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: false,
    securityScanning: false,
    evidenceHarness: false,
    debtGates: false,
    suppressions: true,
  },
  thresholds: DEFAULT_THRESHOLDS.L2,
}

// ─── CURRENT_CONFIG_SCHEMA_VERSION ────────────────────────────────────────────

describe('schema version', () => {
  it('CURRENT_CONFIG_SCHEMA_VERSION is 4', () => {
    expect(CURRENT_CONFIG_SCHEMA_VERSION).toBe(4)
  })
})

// ─── migrateV3ToV4 direct ────────────────────────────────────────────────────

describe('migrateV3ToV4', () => {
  it('stamps $schemaVersion: 4', () => {
    const result = migrateV3ToV4(MINIMAL_V3)
    expect(result.$schemaVersion).toBe(4)
  })

  it('initializes kit.measure as empty object when absent', () => {
    const result = migrateV3ToV4(MINIMAL_V3)
    expect(result.kit).toBeDefined()
    expect(result.kit!.measure).toBeDefined()
    expect(typeof result.kit!.measure).toBe('object')
    expect(Object.keys(result.kit!.measure)).toHaveLength(0)
  })

  it('preserves existing kit.measure entries', () => {
    const withMeasure = {
      ...MINIMAL_V3,
      kit: { measure: { N01: { status: 'present' as const, evidence: ['src/foo.ts'] } } },
    }
    const result = migrateV3ToV4(withMeasure)
    expect(result.kit!.measure['N01']).toEqual({ status: 'present', evidence: ['src/foo.ts'] })
  })

  it('preserves unknown top-level fields (forward-compat)', () => {
    const withUnknown = { ...MINIMAL_V3, _futureField: 'value' } as unknown as ArbiterConfigV2
    const result = migrateV3ToV4(withUnknown)
    expect((result as Record<string, unknown>)['_futureField']).toBe('value')
  })

  it('preserves all other config fields unchanged', () => {
    const result = migrateV3ToV4(MINIMAL_V3)
    expect(result.version).toBe(MINIMAL_V3.version)
    expect(result.tools).toEqual(MINIMAL_V3.tools)
    expect(result.governanceLevel).toBe(MINIMAL_V3.governanceLevel)
    expect(result.features).toEqual(MINIMAL_V3.features)
    expect(result.thresholds).toEqual(MINIMAL_V3.thresholds)
  })
})

// ─── Idempotence ──────────────────────────────────────────────────────────────

describe('migrateV3ToV4 — idempotence', () => {
  it('applying twice yields same $schemaVersion', () => {
    const once = migrateV3ToV4(MINIMAL_V3)
    const twice = migrateV3ToV4(once)
    expect(twice.$schemaVersion).toBe(4)
  })

  it('applying twice does not duplicate kit.measure entries', () => {
    const once = migrateV3ToV4(MINIMAL_V3)
    const twice = migrateV3ToV4(once)
    expect(Object.keys(twice.kit!.measure)).toHaveLength(0)
  })
})

// ─── Full migration chain via migrate() ───────────────────────────────────────

describe('migrate() chain reaches v4', () => {
  it('v0 input migrates to $schemaVersion: 4', () => {
    const v0 = {
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: true,
      },
    }
    const result = migrate(v0)
    expect(result.$schemaVersion).toBe(4)
  })

  it('v1 input migrates to $schemaVersion: 4', () => {
    const v1 = { ...MINIMAL_V3, version: '0.1', $schemaVersion: undefined }
    const result = migrate(v1)
    expect(result.$schemaVersion).toBe(4)
  })

  it('v3 baseline compat fixture migrates cleanly to v4', () => {
    const fixturePath = join(ROOT, '__tests__/fixtures/compat/v0.3.0-baseline/arbiter.json')
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown
    const result = migrate(raw)
    expect(result.$schemaVersion).toBe(4)
    expect(result.kit).toBeDefined()
  })
})

// ─── Frozen fixture regression ────────────────────────────────────────────────

describe('v0.1.0 fixture remains unchanged by migration tests', () => {
  it('v0.1.0-ts-cli arbiter.json parses correctly', () => {
    const fixturePath = join(ROOT, '__tests__/fixtures/compat/v0.1.0-ts-cli/arbiter.json')
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown
    // Just reading — do NOT call migrate() on the fixture in THIS test
    // This verifies the fixture file itself is intact (not modified by other tests)
    expect(raw).toMatchObject({ $schemaVersion: 2 })
  })
})
