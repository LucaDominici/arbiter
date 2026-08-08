// SPDX-License-Identifier: Apache-2.0
// CANON-04 render test for scripts/gate-registry.yml.ejs (#2041). The behavioral
// suite (RED tests for lane membership, L3 clamp-freedom, layering emission)
// lives in __tests__/gates/gate-registry.test.ts via loadGateRegistry(), which
// renders this template internally through the real generator path (EJS render
// + YAML parse + shape validation) — this file only pins that path stays green
// with a minimal representative config, satisfying the CANON-04 render-test
// requirement without duplicating the RED-test behavioral suite.
import { describe, it, expect } from 'vitest'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('gate-registry.yml.ejs render (#2041)', () => {
  it('renders, parses, and validates to a non-empty registry with id/level/kind shape', () => {
    const cfg = makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<
      string,
      unknown
    >
    const entries = loadGateRegistry({
      ...cfg,
      packageManager: 'npm',
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: true,
      isL2Plus: true,
      isL3Plus: false,
      isL4: false,
    })
    expect(entries.length).toBeGreaterThan(50)
    for (const e of entries) {
      expect(e).toHaveProperty('id')
      expect(e).toHaveProperty('level')
      expect(e).toHaveProperty('kind')
    }
  })
})
