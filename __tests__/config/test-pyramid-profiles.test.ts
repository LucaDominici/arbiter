import { describe, it, expect } from 'vitest'
import {
  getTestPyramidProfile,
  type TestPyramidProfile,
} from '../../src/config/test-pyramid-profiles.js'

describe('getTestPyramidProfile', () => {
  // ─── backend-web-db ───────────────────────────────────────────────────────

  it('backend-web-db has container integration', () => {
    const p = getTestPyramidProfile('backend-web-db')
    expect(p.hasContainerIntegration).toBe(true)
  })

  it('backend-web-db has E2E tests', () => {
    const p = getTestPyramidProfile('backend-web-db')
    expect(p.hasE2ETests).toBe(true)
  })

  it('backend-web-db has performance tests', () => {
    const p = getTestPyramidProfile('backend-web-db')
    expect(p.hasPerformanceTests).toBe(true)
  })

  it('backend-web-db has contract tests', () => {
    const p = getTestPyramidProfile('backend-web-db')
    expect(p.hasContractTests).toBe(true)
  })

  // ─── cli ──────────────────────────────────────────────────────────────────

  it('cli has no container integration (no Testcontainers)', () => {
    const p = getTestPyramidProfile('cli')
    expect(p.hasContainerIntegration).toBe(false)
  })

  it('cli has no E2E tests', () => {
    const p = getTestPyramidProfile('cli')
    expect(p.hasE2ETests).toBe(false)
  })

  it('cli has no performance tests', () => {
    const p = getTestPyramidProfile('cli')
    expect(p.hasPerformanceTests).toBe(false)
  })

  it('cli has no contract tests', () => {
    const p = getTestPyramidProfile('cli')
    expect(p.hasContractTests).toBe(false)
  })

  it('cli has unit tests', () => {
    const p = getTestPyramidProfile('cli')
    expect(p.hasUnitTests).toBe(true)
  })

  // ─── library ──────────────────────────────────────────────────────────────

  it('library has property-based tests', () => {
    const p = getTestPyramidProfile('library')
    expect(p.hasPropertyTests).toBe(true)
  })

  it('library has no container integration (no DB)', () => {
    const p = getTestPyramidProfile('library')
    expect(p.hasContainerIntegration).toBe(false)
  })

  it('library has no E2E tests', () => {
    const p = getTestPyramidProfile('library')
    expect(p.hasE2ETests).toBe(false)
  })

  // ─── data-pipeline ────────────────────────────────────────────────────────

  it('data-pipeline has container integration', () => {
    const p = getTestPyramidProfile('data-pipeline')
    expect(p.hasContainerIntegration).toBe(true)
  })

  it('data-pipeline has no E2E tests', () => {
    const p = getTestPyramidProfile('data-pipeline')
    expect(p.hasE2ETests).toBe(false)
  })

  it('data-pipeline has contract tests', () => {
    const p = getTestPyramidProfile('data-pipeline')
    expect(p.hasContractTests).toBe(true)
  })

  // ─── frontend-spa ─────────────────────────────────────────────────────────

  it('frontend-spa has E2E tests', () => {
    const p = getTestPyramidProfile('frontend-spa')
    expect(p.hasE2ETests).toBe(true)
  })

  it('frontend-spa has no container integration', () => {
    const p = getTestPyramidProfile('frontend-spa')
    expect(p.hasContainerIntegration).toBe(false)
  })

  it('frontend-spa has no performance tests', () => {
    const p = getTestPyramidProfile('frontend-spa')
    expect(p.hasPerformanceTests).toBe(false)
  })

  // ─── embedded ─────────────────────────────────────────────────────────────

  it('embedded has no E2E tests', () => {
    const p = getTestPyramidProfile('embedded')
    expect(p.hasE2ETests).toBe(false)
  })

  it('embedded has no container integration', () => {
    const p = getTestPyramidProfile('embedded')
    expect(p.hasContainerIntegration).toBe(false)
  })

  it('embedded has no performance tests', () => {
    const p = getTestPyramidProfile('embedded')
    expect(p.hasPerformanceTests).toBe(false)
  })

  // ─── levels array ─────────────────────────────────────────────────────────

  it('all profiles have at least one level', () => {
    const archetypes = [
      'backend-web-db',
      'cli',
      'library',
      'data-pipeline',
      'frontend-spa',
      'embedded',
    ] as const
    for (const a of archetypes) {
      expect(getTestPyramidProfile(a).levels.length).toBeGreaterThan(0)
    }
  })

  it('each level has name, description, and tools', () => {
    const p = getTestPyramidProfile('backend-web-db')
    for (const level of p.levels) {
      expect(level.name).toBeTruthy()
      expect(level.description).toBeTruthy()
      expect(level.tools).toBeTruthy()
    }
  })

  it('backend-web-db has more levels than cli', () => {
    expect(getTestPyramidProfile('backend-web-db').levels.length).toBeGreaterThan(
      getTestPyramidProfile('cli').levels.length,
    )
  })

  // ─── type completeness ────────────────────────────────────────────────────

  it('returned object satisfies TestPyramidProfile interface', () => {
    const p: TestPyramidProfile = getTestPyramidProfile('backend-web-db')
    expect(p.archetype).toBe('backend-web-db')
    expect(typeof p.hasUnitTests).toBe('boolean')
    expect(typeof p.hasContainerIntegration).toBe('boolean')
    expect(typeof p.hasPropertyTests).toBe('boolean')
    expect(typeof p.hasE2ETests).toBe('boolean')
    expect(typeof p.hasPerformanceTests).toBe('boolean')
    expect(typeof p.hasContractTests).toBe('boolean')
    expect(Array.isArray(p.levels)).toBe(true)
  })
})
