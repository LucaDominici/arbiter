// SPDX-License-Identifier: Apache-2.0
// Render tests for the regulated / high-assurance overlay templates. Asserts the
// policy manifest and policy doc render cleanly, declare the regulated floor, and
// are de-identified (neutral high-assurance vocabulary only — no proprietary or
// sector/regulation-specific identifiers).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(template: string, overrides: Parameters<typeof makeConfig>[1] = {}): string {
  const config = makeConfig('/tmp/test', { industryOverlay: 'regulated', ...overrides })
  return renderTemplate(template, config as unknown as Record<string, unknown>)
}

describe('regulated/overlay.json.ejs — policy manifest', () => {
  it('renders valid JSON with all five regulated pillars at the floor', () => {
    const out = render('regulated/overlay.json.ejs')
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    const m = JSON.parse(out)
    expect(m.separationOfDuties.requireHumanApprovalOnAiAuthoredPR).toBe(true)
    expect(m.separationOfDuties.minHumanApprovals).toBeGreaterThanOrEqual(1)
    expect(m.auditTrail.retentionDays).toBeGreaterThanOrEqual(365)
    expect(m.suppressionExpiry.mandatory).toBe(true)
    expect(m.attestation.cosign).toBe(true)
    expect(m.attestation.sbom).toBe(true)
    expect(typeof m.mutationCoverage.minScore).toBe('number')
  })

  it('honours the configured mutation threshold when present', () => {
    const out = render('regulated/overlay.json.ejs', {
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 75,
        cyclomaticComplexity: 10,
        methodLength: 40,
        maxParams: 5,
      },
    })
    expect(JSON.parse(out).mutationCoverage.minScore).toBe(75)
  })
})

describe('scripts/check-regulated-overlay.mjs.ejs — fail-closed gate script', () => {
  it('renders a clean Node script (shebang, fail-closed exit codes, no EJS leaks)', () => {
    const out = render('scripts/check-regulated-overlay.mjs.ejs')
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(out).toContain('.arbiter/regulated/overlay.json')
    expect(out).toContain('process.exit(2)') // fail-closed on missing/unparseable manifest
    expect(out).toContain('process.exit(1)') // floor violation
  })
})

describe('regulated/regulated-overlay.md.ejs — policy doc', () => {
  it('renders neutral, de-identified high-assurance vocabulary', () => {
    const out = render('regulated/regulated-overlay.md.ejs', { projectName: 'acme-svc' })
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out).toContain('high-assurance')
    expect(out).toContain('Separation of duties')
    expect(out).toContain('check-regulated-overlay.mjs')
    // de-identified: no sector/regulation/proprietary identifiers
    expect(out).not.toMatch(/pharma|21 CFR|HIPAA/i)
  })
})
