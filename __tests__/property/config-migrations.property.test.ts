// SPDX-License-Identifier: Apache-2.0
// #1049 — fast-check property tests for pure config-migration functions.
// Targets: migrateV0ToV1 (field-preserving version stamp) and migrateV2ToV3 (schemaVersion bump).
// Both are side-effect-free transforms — ideal property-test targets.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { migrateV0ToV1 } from '../../src/config/migrations/v0-to-v1.js'
import { migrateV2ToV3 } from '../../src/config/migrations/v2-to-v3.js'
import type { ArbiterConfigV2 } from '../../src/config/schema.js'

const FC_CONFIG = {
  seed: process.env.FC_SEED != null ? Number(process.env.FC_SEED) : 42,
  numRuns: 50,
  endOnFailure: true,
}

// Arbitrary for a minimal ArbiterConfigV2 — only required fields.
const arbiterConfigV2 = (): fc.Arbitrary<ArbiterConfigV2> =>
  fc
    .record({
      version: fc.stringMatching(/^[0-9]+\.[0-9]+$/),
      $schemaVersion: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 3 })),
      tools: fc.constant([]),
      governanceLevel: fc.constantFrom('L1' as const, 'L2' as const, 'L3' as const),
      useGitHub: fc.boolean(),
      features: fc.record({
        riskMatrixGating: fc.boolean(),
        requireStridePerFeature: fc.boolean(),
        piiScanEnabled: fc.boolean(),
        mutationTestingEnabled: fc.boolean(),
        licenseAuditEnabled: fc.boolean(),
      }),
      thresholds: fc.record({
        lineCoverage: fc.integer({ min: 1, max: 100 }),
        branchCoverage: fc.integer({ min: 1, max: 100 }),
        mutationScore: fc.integer({ min: 0, max: 100 }),
        cyclomaticComplexity: fc.integer({ min: 1, max: 100 }),
        methodLength: fc.integer({ min: 1, max: 100 }),
        maxParams: fc.integer({ min: 1, max: 20 }),
      }),
    })
    .map((r) => r as ArbiterConfigV2)

describe('migrateV0ToV1 properties', () => {
  it('stamps version: "0.1" on any plain object', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (input) => {
        const result = migrateV0ToV1(input)
        expect(result.version).toBe('0.1')
      }),
      FC_CONFIG,
    )
  })

  it('preserves all input fields in output', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (input) => {
        const result = migrateV0ToV1(input)
        for (const [key, value] of Object.entries(input)) {
          if (key === 'version') continue
          expect(result).toHaveProperty(key, value)
        }
      }),
      FC_CONFIG,
    )
  })

  it('throws on non-object inputs', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (nonObject) => {
          expect(() => migrateV0ToV1(nonObject)).toThrow('arbiter.json must be a non-null object')
        },
      ),
      FC_CONFIG,
    )
  })
})

describe('migrateV2ToV3 properties', () => {
  it('always outputs $schemaVersion === 3', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(arbiterConfigV2(), (config) => {
        const result = migrateV2ToV3(config)
        expect(result.$schemaVersion).toBe(3)
      }),
      FC_CONFIG,
    )
  })

  it('preserves all fields except $schemaVersion', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(arbiterConfigV2(), (config) => {
        const result = migrateV2ToV3(config)
        for (const key of Object.keys(config) as (keyof ArbiterConfigV2)[]) {
          if (key === '$schemaVersion') continue
          expect(result[key]).toStrictEqual(config[key])
        }
      }),
      FC_CONFIG,
    )
  })

  it('is idempotent — applying twice gives same result as once', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(arbiterConfigV2(), (config) => {
        const once = migrateV2ToV3(config)
        const twice = migrateV2ToV3(once)
        expect(twice).toStrictEqual(once)
      }),
      FC_CONFIG,
    )
  })
})
