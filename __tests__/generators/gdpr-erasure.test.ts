// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGdprErasure } from '../../src/generators/gdpr-erasure.js'

const BANNED = /\b(viafera|shipment|freight|driver|carrier|load|cargo|dispatch|logistics)\b/i

function strippedBody(content: string): string {
  const lines = content.split('\n')
  let inExempt = false
  const kept: string[] = []
  for (const line of lines) {
    if (/^## (Provenance|Reference Implementations)/i.test(line)) {
      inExempt = true
    } else if (/^## /.test(line)) {
      inExempt = false
    }
    if (!inExempt) kept.push(line)
  }
  return kept.join('\n')
}

describe('generateGdprErasure (#713)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits zero files when flag is absent', () => {
    const result = generateGdprErasure(makeConfig(dir))
    expect(result.files).toHaveLength(0)
  })

  it('emits zero files when flag is false', () => {
    const result = generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: false }))
    expect(result.files).toHaveLength(0)
  })

  it('emits the erasure runbook when flag is true', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true }))
    expect(existsSync(join(dir, 'docs', 'SYSTEM', 'GDPR_ERASURE_RUNBOOK.md'))).toBe(true)
  })

  // load-bearing: Keycloak audit-discovered hard-delete fix must be present
  it('runbook contains the Keycloak hard-delete step', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' }))
    const content = readFileSync(join(dir, 'docs', 'SYSTEM', 'GDPR_ERASURE_RUNBOOK.md'), 'utf-8')
    expect(content).toContain('DELETE /admin/realms/{realm}/users/{user-id}')
  })

  // vendor neutrality: other IDPs must appear alongside Keycloak
  it('runbook lists Auth0, Cognito and Okta alongside Keycloak', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' }))
    const content = readFileSync(join(dir, 'docs', 'SYSTEM', 'GDPR_ERASURE_RUNBOOK.md'), 'utf-8')
    expect(content).toContain('Auth0')
    expect(content).toContain('Cognito')
    expect(content).toContain('Okta')
  })

  // framework-generality: no Viafera domain vocabulary in runbook (Provenance section exempted)
  it('runbook contains no banned domain vocabulary', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' }))
    const content = readFileSync(join(dir, 'docs', 'SYSTEM', 'GDPR_ERASURE_RUNBOOK.md'), 'utf-8')
    const match = strippedBody(content).match(BANNED)
    expect(match, `Banned vocabulary found: "${match?.[0]}"`).toBeNull()
  })

  it('emits a Java hook stub for java language', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'java' }))
    expect(
      existsSync(join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'GdprErasureService.java')),
    ).toBe(true)
  })

  it('java hook stub contains no banned domain vocabulary', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'java' }))
    const content = readFileSync(
      join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'GdprErasureService.java'),
      'utf-8',
    )
    expect(BANNED.test(content)).toBe(false)
  })

  it('emits a TypeScript hook stub for typescript language', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' }))
    expect(
      existsSync(join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'GdprErasureService.ts')),
    ).toBe(true)
  })

  it('typescript hook stub contains no banned domain vocabulary', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' }))
    const content = readFileSync(
      join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'GdprErasureService.ts'),
      'utf-8',
    )
    const match = content.match(BANNED)
    expect(match, `Banned vocabulary found: "${match?.[0]}"`).toBeNull()
  })

  it('emits a Go hook stub for go language', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'go' }))
    expect(existsSync(join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'gdpr_erasure.go'))).toBe(
      true,
    )
  })

  it('go hook stub contains no banned domain vocabulary', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'go' }))
    const content = readFileSync(
      join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'gdpr_erasure.go'),
      'utf-8',
    )
    const match = content.match(BANNED)
    expect(match, `Banned vocabulary found: "${match?.[0]}"`).toBeNull()
  })

  it('kotlin maps to java hook stub', () => {
    generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'kotlin' }))
    expect(
      existsSync(join(dir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks', 'GdprErasureService.java')),
    ).toBe(true)
  })

  it('unsupported language throws rather than silently emitting a wrong stub', () => {
    expect(() =>
      generateGdprErasure(makeConfig(dir, { enableGdprErasureRunbook: true, language: 'rust' })),
    ).toThrow(/no hook stub template for language 'rust'/)
  })

  it('is skipIfExists on runbook — does not overwrite', () => {
    const cfg = makeConfig(dir, { enableGdprErasureRunbook: true, language: 'typescript' })
    const r1 = generateGdprErasure(cfg)
    const runbookResult = r1.files.find((f) => f.path.endsWith('GDPR_ERASURE_RUNBOOK.md'))
    expect(runbookResult?.action).toBe('created')
    const r2 = generateGdprErasure(cfg)
    const runbookResult2 = r2.files.find((f) => f.path.endsWith('GDPR_ERASURE_RUNBOOK.md'))
    expect(runbookResult2?.action).toBe('skipped')
  })
})
