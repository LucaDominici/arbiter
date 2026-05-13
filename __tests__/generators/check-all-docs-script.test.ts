import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('generateCheckAll — docs-check wiring (#356, CANON-01)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-docs-check-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits scripts/check-docs.mjs for L2+ projects', () => {
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'check-docs.mjs'))).toBe(true)
  })

  it('does NOT emit check-docs.mjs at L1 (mirrors CI gating)', () => {
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'scripts', 'check-docs.mjs'))).toBe(false)
  })

  it('emitted check-docs.mjs honors [skip-docs] token', () => {
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-docs.mjs'), 'utf-8')
    expect(content).toContain('[skip-docs]')
  })
})
