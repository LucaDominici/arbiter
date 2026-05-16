import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateRiskRegister } from '../../src/generators/risk-register.js'

describe('generateRiskRegister (#712)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/GOVERNANCE/RISK_REGISTER.md', () => {
    generateRiskRegister(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'RISK_REGISTER.md'))).toBe(true)
  })

  it('generates docs/GOVERNANCE/RISK_ASSESSMENT_TEMPLATE.md', () => {
    generateRiskRegister(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'RISK_ASSESSMENT_TEMPLATE.md'))).toBe(true)
  })

  it('generated risk register contains project name', () => {
    generateRiskRegister(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GOVERNANCE', 'RISK_REGISTER.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('generated risk register contains P×I matrix', () => {
    generateRiskRegister(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'GOVERNANCE', 'RISK_REGISTER.md'), 'utf-8')
    expect(content).toMatch(/P.I|Probability.*Impact|probability.*impact/i)
  })

  it('is skipIfExists — does not overwrite existing files', () => {
    const result1 = generateRiskRegister(makeConfig(dir))
    expect(result1.files.every((f) => f.action === 'created')).toBe(true)

    const result2 = generateRiskRegister(makeConfig(dir))
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('returns two files', () => {
    const result = generateRiskRegister(makeConfig(dir))
    expect(result.files).toHaveLength(2)
  })
})
