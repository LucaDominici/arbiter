// SPDX-License-Identifier: Apache-2.0
// Test-only fixture: the canonical default arbiter.json config.
//
// Relocated from src/utils/config.ts during the ts-prune unwired-exports
// burn-down (docs/audits/unwired-exports-2026-06-01.md). It had zero production
// caller — `init` builds config via the wizard / buildArbiterConfig, not this
// factory — so it lived only as test setup. Keeping it in src would either trip
// the new `ts-prune` gate or require a CANON-09-violating exemption; relocating
// it to the test surface keeps the fixture without claiming it is product code.
import type { ArbiterConfig } from '../../src/utils/config.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { presetToTiers, defaultPresetForLevel } from '../../src/invariants/filter.js'

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
