// SPDX-License-Identifier: Apache-2.0
// #1253: ISO 9001 quality-process overlay — orthogonal to the audit-trail overlays.
// Emits a requirement→test RTM, a document-control register, a CAPA log, and an
// enforceable gate script — all language-neutral.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateIso9001 } from '../../src/generators/iso9001.js'
import { buildRegistry } from '../../src/generators/registry.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

describe('generateIso9001 — quality-process overlay (#1253)', () => {
  it('emits RTM + doc-control register + CAPA log + gate script for industryOverlay=iso9001', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'iso9001' })
    const result = generateIso9001(config)

    // four deliverables: three docs + one enforceable gate script
    expect(result.files.length).toBe(4)

    const rtm = join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md')
    const docControl = join(dir, 'docs/quality/DOCUMENT_CONTROL.md')
    const capa = join(dir, 'docs/quality/CAPA_LOG.md')
    const gate = join(dir, 'scripts/check-iso9001.mjs')

    expect(existsSync(rtm)).toBe(true)
    expect(existsSync(docControl)).toBe(true)
    expect(existsSync(capa)).toBe(true)
    expect(existsSync(gate)).toBe(true)
  })

  it('RTM mirrors the FEATURE_MATRIX RTM schema (sentinel + requirement→test row)', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'iso9001' })
    generateIso9001(config)
    const rtm = readFileSync(join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md'), 'utf-8')

    // reused machinery: same sentinel markers the matrix gate parses
    expect(rtm).toContain('<!-- ISO9001_RTM_START -->')
    expect(rtm).toContain('<!-- ISO9001_RTM_END -->')
    // requirement→test columns
    expect(rtm).toContain('requirement_id')
    expect(rtm).toContain('test_ref')
    expect(rtm).toContain('status')
  })

  it('document-control register carries doc_version + controlled-doc table', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'iso9001' })
    generateIso9001(config)
    const docControl = readFileSync(join(dir, 'docs/quality/DOCUMENT_CONTROL.md'), 'utf-8')

    expect(docControl).toContain('doc_version')
    expect(docControl).toContain('<!-- DOC_CONTROL_START -->')
    expect(docControl).toContain('<!-- DOC_CONTROL_END -->')
  })

  it('CAPA log carries a controlled corrective/preventive-action table', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'iso9001' })
    generateIso9001(config)
    const capa = readFileSync(join(dir, 'docs/quality/CAPA_LOG.md'), 'utf-8')

    expect(capa).toContain('<!-- CAPA_START -->')
    expect(capa).toContain('<!-- CAPA_END -->')
    expect(capa).toContain('capa_id')
    expect(capa).toContain('corrective')
  })

  it('is language-neutral — works on a non-Java stack with no Java/JPA leakage', () => {
    dir = createTestProject('python')
    const config = makeConfig(dir, { language: 'python', industryOverlay: 'iso9001' })
    const result = generateIso9001(config)
    expect(result.files.length).toBe(4)
    const rtm = readFileSync(join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md'), 'utf-8')
    expect(rtm).not.toContain('@Entity')
    expect(rtm).not.toContain('.java')
  })

  it('emits nothing for other overlays (orthogonal — does not hijack pharma/sox/gdpr/generic)', () => {
    dir = createTestProject('typescript')
    for (const overlay of ['pharma', 'sox', 'gdpr', 'generic', 'none'] as const) {
      const config = makeConfig(dir, { language: 'typescript', industryOverlay: overlay })
      expect(generateIso9001(config).files.length).toBe(0)
    }
    expect(generateIso9001(makeConfig(dir, { language: 'typescript' })).files.length).toBe(0)
  })

  it('registry wires the iso9001 spec — enabled only for industryOverlay=iso9001', () => {
    const on = buildRegistry(makeConfig('/tmp', { industryOverlay: 'iso9001' })).find(
      (s) => s.key === 'iso9001',
    )
    expect(on?.enabled).toBe(true)
    const off = buildRegistry(makeConfig('/tmp', { industryOverlay: 'pharma' })).find(
      (s) => s.key === 'iso9001',
    )
    expect(off?.enabled).toBe(false)
  })

  it('docs are brownfield-safe (skipIfExists on re-run)', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'iso9001' })
    generateIso9001(config)
    const rtm = join(dir, 'docs/quality/REQUIREMENTS_TRACEABILITY.md')
    writeFileSync(rtm, '# user customised\n')
    const second = generateIso9001(config)
    expect(second.files.every((f) => f.action === 'skipped')).toBe(true)
    expect(readFileSync(rtm, 'utf-8')).toBe('# user customised\n')
  })
})
