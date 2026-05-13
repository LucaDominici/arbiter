import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-all.mjs')
const content = readFileSync(SCRIPT, 'utf-8')

describe('check-all.mjs L1 wiring', () => {
  it('invokes check-matrix-fixtures.mjs in L1 block (#179)', () => {
    const l2BlockIdx = content.indexOf('// ─── L2/L3: Full checks')
    const matrixIdx = content.indexOf('check-matrix-fixtures.mjs')
    expect(matrixIdx).toBeGreaterThan(-1)
    expect(matrixIdx).toBeLessThan(l2BlockIdx)
  })

  it("matrix fixtures step uses 'node' runner (#179)", () => {
    const idx = content.indexOf('check-matrix-fixtures.mjs')
    expect(idx).toBeGreaterThan(-1)
    const surrounding = content.slice(Math.max(0, idx - 100), idx)
    expect(surrounding).toMatch(/['"]node['"]/)
  })
})
