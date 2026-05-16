import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCompliance } from '../../src/generators/compliance.js'

describe('generateCompliance (#710)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/COMPLIANCE_MAPPING.md', () => {
    generateCompliance(makeConfig(dir, { enableIso27001Mapping: true }))
    expect(existsSync(join(dir, 'docs', 'COMPLIANCE_MAPPING.md'))).toBe(true)
  })

  it('generated file contains project name', () => {
    generateCompliance(makeConfig(dir, { enableIso27001Mapping: true }))
    const content = readFileSync(join(dir, 'docs', 'COMPLIANCE_MAPPING.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('ISO 27001 section present when enableIso27001Mapping=true', () => {
    generateCompliance(makeConfig(dir, { enableIso27001Mapping: true }))
    const content = readFileSync(join(dir, 'docs', 'COMPLIANCE_MAPPING.md'), 'utf-8')
    expect(content).toMatch(/ISO 27001/i)
  })

  it('NIS2 section present when enableNis2Mapping=true', () => {
    generateCompliance(makeConfig(dir, { enableNis2Mapping: true }))
    const content = readFileSync(join(dir, 'docs', 'COMPLIANCE_MAPPING.md'), 'utf-8')
    expect(content).toMatch(/NIS2|NIS 2/i)
  })

  it('GDPR section present when enableGdprMapping=true', () => {
    generateCompliance(makeConfig(dir, { enableGdprMapping: true }))
    const content = readFileSync(join(dir, 'docs', 'COMPLIANCE_MAPPING.md'), 'utf-8')
    expect(content).toMatch(/GDPR/i)
  })

  it('is skipIfExists — does not overwrite existing file', () => {
    const result1 = generateCompliance(makeConfig(dir, { enableIso27001Mapping: true }))
    expect(result1.files[0].action).toBe('created')

    const result2 = generateCompliance(makeConfig(dir, { enableIso27001Mapping: true }))
    expect(result2.files[0].action).toBe('skipped')
  })
})
