/**
 * Tests for src/compliance/loader.ts (#263).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { loadComplianceMappings } from '../../src/compliance/loader.js'

const SAMPLE_COMPLIANCE_YAML = `
# Compliance mappings for arbiter
INV-01:
  - standard: SOC2
    controlId: CC6.1
  - standard: ISO27001
    controlId: A.14.2.1
INV-04:
  - standard: SOC2
    controlId: CC7.2
`

describe('loadComplianceMappings (#263)', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      if (fn !== undefined) fn()
    }
  })

  it('returns undefined when compliance.yaml does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compliance-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const result = loadComplianceMappings(dir, 'INV-01')
    expect(result).toBeUndefined()
  })

  it('returns mappings for a known node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compliance-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'compliance.yaml'), SAMPLE_COMPLIANCE_YAML, 'utf-8')

    const result = loadComplianceMappings(dir, 'INV-01')
    expect(result).toBeDefined()
    expect(result).toHaveLength(2)
    expect(result?.[0]?.standard).toBe('SOC2')
    expect(result?.[0]?.controlId).toBe('CC6.1')
    expect(result?.[1]?.standard).toBe('ISO27001')
    expect(result?.[1]?.controlId).toBe('A.14.2.1')
  })

  it('returns undefined for a node not in the mapping file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compliance-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'compliance.yaml'), SAMPLE_COMPLIANCE_YAML, 'utf-8')

    const result = loadComplianceMappings(dir, 'INV-99')
    expect(result).toBeUndefined()
  })

  it('returns mappings for a second node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compliance-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'compliance.yaml'), SAMPLE_COMPLIANCE_YAML, 'utf-8')

    const result = loadComplianceMappings(dir, 'INV-04')
    expect(result).toBeDefined()
    expect(result).toHaveLength(1)
    expect(result?.[0]?.standard).toBe('SOC2')
    expect(result?.[0]?.controlId).toBe('CC7.2')
  })
})
