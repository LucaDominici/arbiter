// SPDX-License-Identifier: Apache-2.0
//
// #1267 — deterministic agent-dispatch matrix resolver.
// The matrix is a DECLARED oracle: (tier x track x review_mode x pr_type) -> required
// agent/vertical set, resolved UNION-only (additive; never narrows below the tier floor).
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  loadDispatchMatrix,
  resolveRequiredAgents,
  matrixVerticalsForTier,
  type DispatchKey,
} from '../../src/review/dispatch-matrix.js'

const REPO_ROOT = resolve(process.cwd())

describe('loadDispatchMatrix — reads + validates the oracle JSON', () => {
  it('loads the real .claude/agent-dispatch-matrix.json with the expected axes', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    expect(m.axes.tier).toEqual(['XS', 'S', 'Standard'])
    expect(m.axes.review_mode).toEqual(['plan', 'code'])
    expect(m.tier_verticals.Standard).toContain('security')
  })

  it('throws (fail-loud) when the matrix file is absent', () => {
    expect(() => loadDispatchMatrix('/nonexistent-dir-xyz')).toThrow()
  })
})

describe('matrixVerticalsForTier — the tier floor projection (SSOT for size-floor)', () => {
  it('XS = the always_on triad only', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    expect(matrixVerticalsForTier(m, 'XS')).toEqual(['bugs', 'type-safety', 'domain'])
  })

  it('Standard widens to the full breadth', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    const v = matrixVerticalsForTier(m, 'Standard')
    expect(v).toContain('security')
    expect(v).toContain('data-integrity')
    expect(v).toContain('silent-failures')
  })
})

describe('resolveRequiredAgents — declared oracle resolution (additive, fail-safe)', () => {
  it('resolves a sampled tuple to its expected required agent set', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    const key: DispatchKey = {
      tier: 'Standard',
      track: 'security',
      review_mode: 'code',
      pr_type: 'feat',
    }
    const got = resolveRequiredAgents(m, key)
    // Standard tier floor + security track modifier (already in floor) + feat modifier (test-quality, in floor).
    // The result is the UNION; every Standard-floor vertical must be present, plus security.
    for (const v of ['bugs', 'type-safety', 'domain', 'test-quality', 'security']) {
      expect(got.agents).toContain(v)
    }
    expect(got.passCount).toBe(5)
  })

  it('is UNION-only: track/pr_type modifiers never remove a tier-floor vertical', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    const floor = matrixVerticalsForTier(m, 'Standard')
    const got = resolveRequiredAgents(m, {
      tier: 'Standard',
      track: 'default',
      review_mode: 'code',
      pr_type: 'docs',
    })
    for (const v of floor) expect(got.agents).toContain(v)
  })

  it('a docs+XS+default tuple stays at the minimal triad (never under the floor)', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    const got = resolveRequiredAgents(m, {
      tier: 'XS',
      track: 'default',
      review_mode: 'code',
      pr_type: 'docs',
    })
    expect(got.agents).toContain('bugs')
    expect(got.agents).toContain('type-safety')
    expect(got.agents).toContain('domain')
    expect(got.agents).not.toContain('security')
  })

  it('throws fail-loud on an unknown axis value (no silent drop)', () => {
    const m = loadDispatchMatrix(REPO_ROOT)
    expect(() =>
      resolveRequiredAgents(m, {
        tier: 'Huge' as DispatchKey['tier'],
        track: 'default',
        review_mode: 'code',
        pr_type: 'feat',
      }),
    ).toThrow()
  })
})
