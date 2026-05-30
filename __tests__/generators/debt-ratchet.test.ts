import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
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

  // #293/#1077: writeFile backs up only when regenerated content DIFFERS from
  // disk. A byte-identical re-run now skips (idempotence). Each script below is
  // verified on both branches: edited-then-regenerated → backed-up-and-replaced,
  // and a clean re-run → skipped with no churned backup.
  for (const script of ['debt-lib.mjs', 'capture-debt-baseline.mjs', 'debt-report.mjs'] as const) {
    it(`${script} backs up + replaces when content differs on re-run (#293/#1077)`, () => {
      const config = makeConfig(dir, { enableDebtGates: true })
      const r1 = generateDebtRatchet(config)
      const path = r1.files.find((x) => x.path.endsWith(script))!.path
      writeFileSync(path, '// user-edited\n', 'utf-8')
      const r2 = generateDebtRatchet(config)
      const f = r2.files.find((x) => x.path.endsWith(script))
      expect(f?.action).toBe('backed-up-and-replaced')
      expect(existsSync(`${path}.arbiter-backup`)).toBe(true)
    })

    it(`${script} skips a byte-identical re-run with no backup (#1077 F6)`, () => {
      const config = makeConfig(dir, { enableDebtGates: true })
      const r1 = generateDebtRatchet(config)
      const path = r1.files.find((x) => x.path.endsWith(script))!.path
      const r2 = generateDebtRatchet(config)
      const f = r2.files.find((x) => x.path.endsWith(script))
      expect(f?.action).toBe('skipped')
      expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
    })
  }

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
