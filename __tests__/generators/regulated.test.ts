// SPDX-License-Identifier: Apache-2.0
// Regulated / high-assurance overlay — opt-in bundle of separation-of-duties,
// audit retention, suppression-expiry, signing/SBOM, and a mutation floor.
// Orthogonal to the audit-trail / quality-process overlays; emits a policy
// manifest, a fail-closed gate, and a policy doc only when selected.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateRegulated } from '../../src/generators/regulated.js'
import { buildRegistry } from '../../src/generators/registry.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

describe('generateRegulated — high-assurance overlay', () => {
  it('emits the policy manifest + fail-closed gate + policy doc for industryOverlay=regulated', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'regulated' })
    const result = generateRegulated(config)

    expect(result.files.length).toBe(3)

    const manifest = join(dir, '.arbiter/regulated/overlay.json')
    const gate = join(dir, 'scripts/check-regulated-overlay.mjs')
    const doc = join(dir, 'docs/compliance/regulated-overlay.md')

    expect(existsSync(manifest)).toBe(true)
    expect(existsSync(gate)).toBe(true)
    expect(existsSync(doc)).toBe(true)
  })

  it('manifest declares all five regulated pillars with an enforceable floor', () => {
    dir = createTestProject('typescript')
    generateRegulated(makeConfig(dir, { language: 'typescript', industryOverlay: 'regulated' }))
    const manifest = JSON.parse(readFileSync(join(dir, '.arbiter/regulated/overlay.json'), 'utf-8'))
    expect(manifest.separationOfDuties.requireHumanApprovalOnAiAuthoredPR).toBe(true)
    expect(manifest.separationOfDuties.minHumanApprovals).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(manifest.separationOfDuties.aiAuthorMarkers)).toBe(true)
    expect(manifest.auditTrail.retentionDays).toBeGreaterThanOrEqual(365)
    expect(manifest.suppressionExpiry.mandatory).toBe(true)
    expect(manifest.attestation.cosign).toBe(true)
    expect(manifest.attestation.sbom).toBe(true)
    expect(typeof manifest.mutationCoverage.minScore).toBe('number')
  })

  it('is language-neutral — works on a non-TS stack with no domain-specific identifiers', () => {
    dir = createTestProject('python')
    const result = generateRegulated(
      makeConfig(dir, { language: 'python', industryOverlay: 'regulated' }),
    )
    expect(result.files.length).toBe(3)
    const doc = readFileSync(join(dir, 'docs/compliance/regulated-overlay.md'), 'utf-8')
    // de-identified: neutral high-assurance vocabulary only
    expect(doc).toContain('high-assurance')
    expect(doc).toContain('Separation of duties')
  })

  it('emits nothing for other overlays (orthogonal — does not hijack pharma/gdpr/iso9001/none)', () => {
    dir = createTestProject('typescript')
    for (const overlay of [
      'pharma',
      'sox',
      'gdpr',
      'generic',
      'iso9001',
      'iso27001',
      'none',
    ] as const) {
      const config = makeConfig(dir, { language: 'typescript', industryOverlay: overlay })
      expect(generateRegulated(config).files.length).toBe(0)
    }
    expect(generateRegulated(makeConfig(dir, { language: 'typescript' })).files.length).toBe(0)
  })

  it('registry wires the regulated-overlay spec — enabled only for industryOverlay=regulated', () => {
    const on = buildRegistry(makeConfig('/tmp', { industryOverlay: 'regulated' })).find(
      (s) => s.key === 'regulated-overlay',
    )
    expect(on?.enabled).toBe(true)
    const off = buildRegistry(makeConfig('/tmp', { industryOverlay: 'pharma' })).find(
      (s) => s.key === 'regulated-overlay',
    )
    expect(off?.enabled).toBe(false)
  })

  it('manifest is brownfield-safe (skipIfExists preserves user edits on re-run)', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir, { language: 'typescript', industryOverlay: 'regulated' })
    generateRegulated(config)
    const manifestPath = join(dir, '.arbiter/regulated/overlay.json')
    writeFileSync(manifestPath, '{"separationOfDuties":{"custom":true}}\n')
    const second = generateRegulated(config)
    const manifestResult = second.files.find((f) => f.path.endsWith('overlay.json'))
    expect(manifestResult?.action).toBe('skipped')
    // user edits preserved verbatim
    expect(readFileSync(manifestPath, 'utf-8')).toBe('{"separationOfDuties":{"custom":true}}\n')
    // the managed gate is emitted as a non-skipIfExists artefact
    const gateResult = second.files.find((f) => f.path.endsWith('check-regulated-overlay.mjs'))
    expect(gateResult).toBeDefined()
  })
})
