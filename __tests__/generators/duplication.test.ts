import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDuplication } from '../../src/generators/duplication.js'

describe('generateDuplication (CANON-22 DRY gate)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty when enableDebtGates is false', () => {
    const config = makeConfig(dir, { language: 'typescript', enableDebtGates: false })
    expect(generateDuplication(config).files).toHaveLength(0)
    expect(existsSync(join(dir, '.jscpd.json'))).toBe(false)
  })

  it('returns empty for non-TypeScript stacks (native CPD handles those; gate is TS-rendered)', () => {
    for (const language of ['java', 'multi'] as const) {
      const config = makeConfig(dir, { language, enableDebtGates: true })
      expect(generateDuplication(config).files).toHaveLength(0)
    }
  })

  it('emits a valid .jscpd.json for TypeScript with debt gates (v5 semantics: path+format, no pattern)', () => {
    const config = makeConfig(dir, { language: 'typescript', enableDebtGates: true })
    const result = generateDuplication(config)
    expect(result.files.some((f) => f.path.endsWith('.jscpd.json'))).toBe(true)
    const cfg = JSON.parse(readFileSync(join(dir, '.jscpd.json'), 'utf-8'))
    // jscpd v5 silently ignores `pattern` (0 files scanned) — fileset must be
    // expressed as `path` (read by the generated scripts as positional args)
    // plus a `format` filter (#1286).
    expect(cfg.pattern).toBeUndefined()
    expect(cfg.path).toEqual(['src'])
    expect(cfg.format).toContain('typescript')
    expect(cfg.format).toContain('javascript')
    expect(Array.isArray(cfg.ignore)).toBe(true)
    expect(typeof cfg.threshold).toBe('number')
  })

  it('emits the fail-closed duplication gate script (jscpd v5 exits 0 on empty fileset — #1286)', () => {
    const config = makeConfig(dir, { language: 'typescript', enableDebtGates: true })
    const result = generateDuplication(config)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-duplication.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-duplication.mjs'), 'utf-8')
    expect(script).toContain('jscpdScan')
  })

  it('scales the duplication threshold with governance level (L1 loosest → L3/L4 strict)', () => {
    const thresholdAt = (level: 'L1' | 'L2' | 'L3' | 'L4'): number => {
      const d = createTestProject('typescript')
      try {
        generateDuplication(
          makeConfig(d, { language: 'typescript', enableDebtGates: true, governanceLevel: level }),
        )
        return JSON.parse(readFileSync(join(d, '.jscpd.json'), 'utf-8')).threshold as number
      } finally {
        cleanupTestProject(d)
      }
    }
    expect(thresholdAt('L1')).toBeGreaterThan(thresholdAt('L2'))
    expect(thresholdAt('L2')).toBeGreaterThan(thresholdAt('L3'))
    expect(thresholdAt('L3')).toBeLessThanOrEqual(5)
  })

  it('injects the jscpd devDep so the emitted duplication gate is not dead-on-arrival (CANON-01)', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 't', devDependencies: {} }, null, 2),
    )
    generateDuplication(makeConfig(dir, { language: 'typescript', enableDebtGates: true }))
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
    // Exact pin (no caret): v5 is a days-old Rust-binary rewrite distributed via
    // platform optionalDependencies; floating ranges re-introduce unreviewed
    // behavior drift into governed projects (#1286 RT-06).
    expect(pkg.devDependencies.jscpd).toBe('5.0.6')
  })

  it('honours dryRun — no files written', () => {
    generateDuplication(makeConfig(dir, { language: 'typescript', enableDebtGates: true }), {
      dryRun: true,
    })
    expect(existsSync(join(dir, '.jscpd.json'))).toBe(false)
  })
})
