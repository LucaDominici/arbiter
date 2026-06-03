// SPDX-License-Identifier: Apache-2.0
// #1156: generic L4 audit-trail overlay — decoupled from the pharma Java scaffolding.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePharma } from '../../src/generators/pharma.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

describe('generatePharma — generic audit overlay (#1156)', () => {
  for (const overlay of ['generic', 'sox', 'gdpr'] as const) {
    it(`emits language-neutral audit docs for industryOverlay=${overlay} (no Java entities)`, () => {
      dir = createTestProject('typescript')
      const config = makeConfig(dir, { language: 'typescript', industryOverlay: overlay })
      const result = generatePharma(config)

      expect(result.files.length).toBe(2)
      const policy = join(dir, 'docs/compliance/audit-trail-policy.md')
      const rules = join(dir, 'docs/compliance/audit-gate-rules.md')
      expect(existsSync(policy)).toBe(true)
      expect(existsSync(rules)).toBe(true)

      // Must NOT emit pharma Java entities.
      expect(existsSync(join(dir, 'src/main/java/audit/AuditEvent.java'))).toBe(false)

      const policyText = readFileSync(policy, 'utf-8')
      expect(policyText).toContain(overlay.toUpperCase())
      // Language-neutral: no Java/JPA leakage.
      expect(policyText).not.toContain('@Entity')
      expect(policyText).not.toContain('AuditEvent.java')
      expect(readFileSync(rules, 'utf-8')).toContain('AUD-01')
    })
  }

  it('generic overlay works on a non-Java stack (decoupled from Java)', () => {
    dir = createTestProject('python')
    const config = makeConfig(dir, { language: 'python', industryOverlay: 'generic' })
    const result = generatePharma(config)
    expect(result.files.length).toBe(2)
  })

  it('pharma overlay still emits Java scaffolding (unchanged) and no generic docs', () => {
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.app',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    expect(result.files.length).toBe(3)
    expect(existsSync(join(dir, 'docs/compliance/audit-trail-policy.md'))).toBe(false)
  })

  it('absent / none overlay emits nothing', () => {
    dir = createTestProject('typescript')
    expect(generatePharma(makeConfig(dir, { language: 'typescript' })).files.length).toBe(0)
    expect(
      generatePharma(makeConfig(dir, { language: 'typescript', industryOverlay: 'none' })).files
        .length,
    ).toBe(0)
  })

  it('generic docs are brownfield-safe (skipIfExists on re-run)', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'generic' })
    generatePharma(config)
    const policy = join(dir, 'docs/compliance/audit-trail-policy.md')
    writeFileSync(policy, '# user customised\n')
    const second = generatePharma(config)
    expect(second.files.every((f) => f.action === 'skipped')).toBe(true)
    expect(readFileSync(policy, 'utf-8')).toBe('# user customised\n')
  })
})
