// SPDX-License-Identifier: Apache-2.0
// #1678: the L3 maturity gate must be driven by the ACTUAL emission plan (the enabled
// registry specs), not a hard-coded 2-feature list. These tests exercise the pure
// derivation (deriveL3MaturityChecks) against the REAL registry + REAL matrix — no mocks
// — so a still-ungated emitted cell is now consulted, and an unmodeled language×dim is
// NOT falsely blocked (the #1606 pattern, generalised).
import { describe, it, expect } from 'vitest'
import {
  deriveL3MaturityChecks,
  type L3MaturityCapability,
} from '../../src/commands/init.js'
import { buildRegistry } from '../../src/generators/registry.js'
import { isL3Allowed } from '../../src/utils/maturity-check.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function checksFor(overrides: Partial<ProjectConfig>): L3MaturityCapability[] {
  const config = makeConfig('/tmp/maturity-emission', {
    governanceLevel: 'L3',
    enableMutationTesting: true,
    enableContractTesting: true,
    ...overrides,
  })
  return deriveL3MaturityChecks(config, buildRegistry(config))
}

function blockedFeatures(checks: L3MaturityCapability[]): string[] {
  return checks
    .filter((c) => !isL3Allowed(c.language, c.feature, false).allowed)
    .map((c) => c.feature)
}

describe('deriveL3MaturityChecks — emission-plan-driven L3 gate (#1678)', () => {
  it('consults bdd for a go service — a still-ungated beta cell the old list missed', () => {
    // behavioral-tests (always-on) emits godog for go; matrix bdd:go=beta. The old
    // hard-coded gate only checked mutation/contract/a11y, so bdd:go slipped through.
    const checks = checksFor({ language: 'go', archetype: 'backend-web-db' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({ feature: 'bdd', language: 'go' }),
    )
    expect(blockedFeatures(checks)).toContain('bdd')
  })

  it('blocks a kotlin service on its beta cells (security/coverage/architecture/static_analysis)', () => {
    // Every emitted kotlin tool is beta in the matrix; the gate must surface them.
    const checks = checksFor({ language: 'kotlin', archetype: 'backend-web-db', basePackage: 'com.example' })
    const blocked = blockedFeatures(checks)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked).toEqual(expect.arrayContaining(['security', 'coverage', 'static_analysis']))
  })

  it('does NOT block a typescript service — every emitted TS tool is proven', () => {
    const checks = checksFor({ language: 'typescript', archetype: 'backend-web-db', hasDatabase: true, hasPublicApi: true })
    expect(checks.length).toBeGreaterThan(0)
    expect(blockedFeatures(checks)).toEqual([])
  })

  // #1606: a polyglot `multi` frontend ships the proven TS axe/Playwright binding. a11y
  // must resolve to typescript (proven) — NOT the unmodeled 'multi' cell that would block.
  it('resolves a11y to typescript for a multi frontend and never gates the unmodeled multi cells (#1606)', () => {
    const checks = checksFor({ language: 'multi', archetype: 'frontend-spa' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'a11y',
        language: 'typescript',
      }),
    )
    // No check resolves to the polyglot 'multi' pseudo-language (matrix has no cells).
    expect(checks.every((c) => c.language !== 'multi')).toBe(true)
    // And the multi frontend is therefore not falsely blocked.
    expect(blockedFeatures(checks)).toEqual([])
  })

  it('preserves the #1628 reproduction: a python frontend a11y harness is gated', () => {
    const checks = checksFor({ language: 'python', archetype: 'frontend-spa' })
    expect(checks).toContainEqual(
      expect.objectContaining<Partial<L3MaturityCapability>>({
        feature: 'a11y',
        language: 'python',
      }),
    )
    expect(blockedFeatures(checks)).toContain('a11y')
  })
})
