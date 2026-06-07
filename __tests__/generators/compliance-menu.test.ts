// SPDX-License-Identifier: Apache-2.0
// #1254: compliance-menu generator — emits the (team × compliance) menu doc that
// presents every collaborationMode × industryOverlay cell with rationale, plus the
// (overlay × governanceLevel) coherence guidance. Always-on onboarding aid.
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateComplianceMenu } from '../../src/generators/compliance-menu.js'
import { buildRegistry } from '../../src/generators/registry.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

describe('generateComplianceMenu — (team × compliance) menu doc (#1254)', () => {
  it('emits the menu doc', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript' })
    const result = generateComplianceMenu(config)
    expect(result.files.length).toBe(1)
    expect(existsSync(join(dir, 'docs/COMPLIANCE_MENU.md'))).toBe(true)
  })

  it('presents the team axis (collaborationMode) and the compliance axis (overlays)', () => {
    dir = createTestProject('typescript')
    generateComplianceMenu(makeConfig(dir, { language: 'typescript' }))
    const doc = readFileSync(join(dir, 'docs/COMPLIANCE_MENU.md'), 'utf-8')
    // team axis
    expect(doc).toContain('trunk-solo')
    expect(doc).toContain('peer-review')
    expect(doc).toContain('gated-review')
    // compliance axis
    expect(doc).toContain('pharma')
    expect(doc).toContain('iso27001')
    expect(doc).toContain('iso9001')
    expect(doc).toContain('gdpr')
  })

  it('documents the (overlay × governanceLevel) coherence guidance (heavy → L3+)', () => {
    dir = createTestProject('typescript')
    generateComplianceMenu(makeConfig(dir, { language: 'typescript' }))
    const doc = readFileSync(join(dir, 'docs/COMPLIANCE_MENU.md'), 'utf-8')
    expect(doc).toMatch(/L3|governance/i)
    expect(doc).toMatch(/heavy|coheren|rationale/i)
  })

  it('is language-neutral — identical on a non-TS stack', () => {
    dir = createTestProject('python')
    const result = generateComplianceMenu(makeConfig(dir, { language: 'python' }))
    expect(result.files.length).toBe(1)
    const doc = readFileSync(join(dir, 'docs/COMPLIANCE_MENU.md'), 'utf-8')
    expect(doc).not.toContain('@Entity')
  })

  it('is brownfield-safe (skipIfExists on re-run)', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript' })
    generateComplianceMenu(config)
    const p = join(dir, 'docs/COMPLIANCE_MENU.md')
    writeFileSync(p, '# user customised\n')
    const second = generateComplianceMenu(config)
    expect(second.files.every((f) => f.action === 'skipped')).toBe(true)
    expect(readFileSync(p, 'utf-8')).toBe('# user customised\n')
  })

  it('registry wires the compliance-menu spec — always enabled', () => {
    const spec = buildRegistry(makeConfig('/tmp', { language: 'typescript' })).find(
      (s) => s.key === 'compliance-menu',
    )
    expect(spec?.enabled).toBe(true)
  })
})
