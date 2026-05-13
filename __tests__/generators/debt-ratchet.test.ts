import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtRatchet } from '../../src/generators/debt-ratchet.js'

describe('generateDebtRatchet', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty when enableDebtGates is false', () => {
    const config = makeConfig(dir, { enableDebtGates: false })
    expect(generateDebtRatchet(config).files).toHaveLength(0)
  })

  it('generates 3 files when enableDebtGates is true', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    const result = generateDebtRatchet(config)
    expect(result.files).toHaveLength(3)
  })

  it('generates capture-debt-baseline.mjs', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    expect(existsSync(join(dir, 'scripts', 'capture-debt-baseline.mjs'))).toBe(true)
  })

  it('generates debt-report.mjs', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    expect(existsSync(join(dir, 'scripts', 'debt-report.mjs'))).toBe(true)
  })

  it('debt-lib.mjs creates .arbiter-backup on second run (#293)', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    const r2 = generateDebtRatchet(config)
    const f = r2.files.find((x) => x.path.endsWith('debt-lib.mjs'))
    expect(f?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${f!.path}.arbiter-backup`)).toBe(true)
  })

  it('capture-debt-baseline.mjs creates .arbiter-backup on second run (#293)', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    const r2 = generateDebtRatchet(config)
    const f = r2.files.find((x) => x.path.endsWith('capture-debt-baseline.mjs'))
    expect(f?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${f!.path}.arbiter-backup`)).toBe(true)
  })

  it('debt-report.mjs creates .arbiter-backup on second run (#293)', () => {
    const config = makeConfig(dir, { enableDebtGates: true })
    generateDebtRatchet(config)
    const r2 = generateDebtRatchet(config)
    const f = r2.files.find((x) => x.path.endsWith('debt-report.mjs'))
    expect(f?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${f!.path}.arbiter-backup`)).toBe(true)
  })

  // Test for each stack: typescript, rust, java, go, python
  for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
    it(`generates 3 scripts for ${lang}`, () => {
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
})
