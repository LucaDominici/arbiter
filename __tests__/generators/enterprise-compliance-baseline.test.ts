// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateEnterpriseComplianceBaseline } from '../../src/generators/enterprise-compliance-baseline.js'

describe('generateEnterpriseComplianceBaseline (#711)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits zero files when flag is absent', () => {
    const result = generateEnterpriseComplianceBaseline(makeConfig(dir))
    expect(result.files).toHaveLength(0)
  })

  it('emits zero files when flag is false', () => {
    const result = generateEnterpriseComplianceBaseline(
      makeConfig(dir, { enableEnterpriseComplianceBaseline: false }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('emits docs/SYSTEM/ENTERPRISE_COMPLIANCE.md when flag is true', () => {
    generateEnterpriseComplianceBaseline(
      makeConfig(dir, { enableEnterpriseComplianceBaseline: true }),
    )
    expect(existsSync(join(dir, 'docs', 'SYSTEM', 'ENTERPRISE_COMPLIANCE.md'))).toBe(true)
  })

  it('rendered output starts with # Enterprise Compliance Baseline', () => {
    generateEnterpriseComplianceBaseline(
      makeConfig(dir, { enableEnterpriseComplianceBaseline: true }),
    )
    const content = readFileSync(join(dir, 'docs', 'SYSTEM', 'ENTERPRISE_COMPLIANCE.md'), 'utf-8')
    expect(content.trimStart()).toMatch(/^# Enterprise Compliance Baseline/)
  })

  it('contains ISO 27001 and GDPR references', () => {
    generateEnterpriseComplianceBaseline(
      makeConfig(dir, { enableEnterpriseComplianceBaseline: true }),
    )
    const content = readFileSync(join(dir, 'docs', 'SYSTEM', 'ENTERPRISE_COMPLIANCE.md'), 'utf-8')
    expect(content).toContain('ISO 27001')
    expect(content).toContain('GDPR')
  })

  it('is skipIfExists — does not overwrite existing file', () => {
    const cfg = makeConfig(dir, { enableEnterpriseComplianceBaseline: true })
    const r1 = generateEnterpriseComplianceBaseline(cfg)
    expect(r1.files[0].action).toBe('created')
    const r2 = generateEnterpriseComplianceBaseline(cfg)
    expect(r2.files[0].action).toBe('skipped')
  })
})
