import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtRatchet, computeMetricsProfile } from '../../src/generators/debt-ratchet.js'

describe('computeMetricsProfile', () => {
  it('typescript + frontend-spa → includeBundleSize', () => {
    const config = makeConfig('/tmp/t', {
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    const p = computeMetricsProfile(config)
    expect(p.includeBundleSize).toBe(true)
    expect(p.includePublicApiSurface).toBe(false)
  })

  it('typescript + library → includePublicApiSurface, no bundleSize', () => {
    const config = makeConfig('/tmp/t', {
      language: 'typescript',
      archetype: 'library',
    })
    const p = computeMetricsProfile(config)
    expect(p.includeBundleSize).toBe(false)
    expect(p.includePublicApiSurface).toBe(true)
  })

  it('typescript + backend-web-db → includeBranchCoverage', () => {
    const config = makeConfig('/tmp/t', {
      language: 'typescript',
      archetype: 'backend-web-db',
    })
    const p = computeMetricsProfile(config)
    expect(p.includeBranchCoverage).toBe(true)
    expect(p.spotbugsEnabled).toBe(false)
    expect(p.archunitEnabled).toBe(false)
  })

  it('typescript + cli → no bundle, no surface, no branch', () => {
    const config = makeConfig('/tmp/t', {
      language: 'typescript',
      archetype: 'cli',
    })
    const p = computeMetricsProfile(config)
    expect(p.includeBundleSize).toBe(false)
    expect(p.includePublicApiSurface).toBe(false)
    expect(p.includeBranchCoverage).toBe(false)
  })

  it('java + hexagonal → spotbugsEnabled + archunitEnabled', () => {
    const config = makeConfig('/tmp/t', {
      language: 'java',
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
    })
    const p = computeMetricsProfile(config)
    expect(p.spotbugsEnabled).toBe(true)
    expect(p.archunitEnabled).toBe(true)
    expect(p.includeBranchCoverage).toBe(true)
  })

  it('java + no architecture style → spotbugsEnabled, archunitEnabled false', () => {
    const config = makeConfig('/tmp/t', {
      language: 'java',
      archetype: 'backend-web-db',
      architectureStyle: 'none',
    })
    const p = computeMetricsProfile(config)
    expect(p.spotbugsEnabled).toBe(true)
    expect(p.archunitEnabled).toBe(false)
  })

  it('rust + cli → no spotbugs, no archunit, no bundle', () => {
    const config = makeConfig('/tmp/t', {
      language: 'rust',
      archetype: 'cli',
    })
    const p = computeMetricsProfile(config)
    expect(p.spotbugsEnabled).toBe(false)
    expect(p.archunitEnabled).toBe(false)
    expect(p.includeBundleSize).toBe(false)
  })

  it('library + java → includeBranchCoverage', () => {
    const config = makeConfig('/tmp/t', {
      language: 'java',
      archetype: 'library',
    })
    const p = computeMetricsProfile(config)
    expect(p.includeBranchCoverage).toBe(true)
  })
})

describe('generateDebtRatchet with metricsProfile', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates 3 files when enableDebtGates is true', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    const result = generateDebtRatchet(config)
    expect(result.files).toHaveLength(3)
  })

  it('generates debt-lib.mjs', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    expect(existsSync(join(dir, 'scripts', 'debt-lib.mjs'))).toBe(true)
  })

  it('metricsProfile is passed to templates (capture imports debt-lib.mjs)', () => {
    const config = makeConfig(dir, {
      enableDebtGates: true,
      language: 'typescript',
    })
    generateDebtRatchet(config)
    const capture = readFileSync(join(dir, 'scripts', 'capture-debt-baseline.mjs'), 'utf-8')
    expect(capture).toContain('./debt-lib.mjs')
  })

  it('report imports debt-lib.mjs', () => {
    const config = makeConfig(dir, {
      enableDebtGates: true,
      language: 'typescript',
    })
    generateDebtRatchet(config)
    const report = readFileSync(join(dir, 'scripts', 'debt-report.mjs'), 'utf-8')
    expect(report).toContain('./debt-lib.mjs')
  })

  for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
    it(`generates 3 files for ${lang}`, () => {
      const loopDir = createTestProject(lang)
      initGit(loopDir)
      try {
        const config = makeConfig(loopDir, {
          language: lang,
          enableDebtGates: true,
        })
        const result = generateDebtRatchet(config)
        expect(result.files).toHaveLength(3)
      } finally {
        cleanupTestProject(loopDir)
      }
    })
  }

  it('TS+library: debt-lib.mjs contains publicApiSurface metric (#127)', () => {
    const libraryDir = createTestProject('typescript')
    initGit(libraryDir)
    try {
      const config = makeConfig(libraryDir, {
        language: 'typescript',
        archetype: 'library',
        enableDebtGates: true,
      })
      generateDebtRatchet(config)
      const content = readFileSync(join(libraryDir, 'scripts', 'debt-lib.mjs'), 'utf-8')
      expect(content).toContain('publicApiSurface')
      expect(content).toContain('^export')
    } finally {
      cleanupTestProject(libraryDir)
    }
  })

  it('TS+backend-web-db: debt-lib.mjs does NOT contain publicApiSurface (#127)', () => {
    const serviceDir = createTestProject('typescript')
    initGit(serviceDir)
    try {
      const config = makeConfig(serviceDir, {
        language: 'typescript',
        archetype: 'backend-web-db',
        enableDebtGates: true,
      })
      generateDebtRatchet(config)
      const content = readFileSync(join(serviceDir, 'scripts', 'debt-lib.mjs'), 'utf-8')
      expect(content).not.toContain('publicApiSurface')
    } finally {
      cleanupTestProject(serviceDir)
    }
  })
})
