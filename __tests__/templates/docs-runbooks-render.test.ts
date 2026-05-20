// SPDX-License-Identifier: Apache-2.0
// Render tests for docs/runbooks/*.md.ejs — CANON-04 compliance (#897)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('docs/runbooks/rollback.md.ejs (#897, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/runbooks/rollback.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('interpolates projectName in heading', () => {
    const out = renderTemplate('docs/runbooks/rollback.md.ejs', cfg({ projectName: 'my-svc' }))
    expect(out).toContain('my-svc')
  })

  it('contains rollback decision tree', () => {
    const out = renderTemplate('docs/runbooks/rollback.md.ejs', cfg())
    expect(out).toMatch(/Rollback vs Fix-Forward|decision tree/i)
    expect(out).toContain('data corruption')
  })

  it('contains prerequisites section', () => {
    const out = renderTemplate('docs/runbooks/rollback.md.ejs', cfg())
    expect(out).toMatch(/Prerequisites/i)
  })

  it('contains anti-patterns section', () => {
    const out = renderTemplate('docs/runbooks/rollback.md.ejs', cfg())
    expect(out).toMatch(/Anti-Pattern/i)
  })
})

describe('docs/runbooks/troubleshooting.md.ejs (#897, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/runbooks/troubleshooting.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('interpolates projectName in heading', () => {
    const out = renderTemplate(
      'docs/runbooks/troubleshooting.md.ejs',
      cfg({ projectName: 'my-svc' }),
    )
    expect(out).toContain('my-svc')
  })

  it('contains health check section', () => {
    const out = renderTemplate('docs/runbooks/troubleshooting.md.ejs', cfg())
    expect(out).toMatch(/Health.*Smoke Check|liveness|readiness/i)
  })

  it('contains symptom table', () => {
    const out = renderTemplate('docs/runbooks/troubleshooting.md.ejs', cfg())
    expect(out).toMatch(/Symptom.*Likely Cause|symptom-based/i)
  })

  it('contains escalation section', () => {
    const out = renderTemplate('docs/runbooks/troubleshooting.md.ejs', cfg())
    expect(out).toMatch(/Escalation/i)
  })
})

describe('docs/runbooks/prod-checklist.md.ejs (#897, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/runbooks/prod-checklist.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('interpolates projectName in heading', () => {
    const out = renderTemplate(
      'docs/runbooks/prod-checklist.md.ejs',
      cfg({ projectName: 'my-svc' }),
    )
    expect(out).toContain('my-svc')
  })

  it('contains code & build section', () => {
    const out = renderTemplate('docs/runbooks/prod-checklist.md.ejs', cfg())
    expect(out).toMatch(/Code.*Build|gate passes/i)
  })

  it('contains go/no-go gate section', () => {
    const out = renderTemplate('docs/runbooks/prod-checklist.md.ejs', cfg())
    expect(out).toMatch(/Go.*No-Go|GO.*NO-GO/i)
  })

  it('contains L3 threat model check at L3', () => {
    const out = renderTemplate(
      'docs/runbooks/prod-checklist.md.ejs',
      cfg({ governanceLevel: 'L3' }),
    )
    expect(out).toMatch(/STRIDE threat model/i)
  })

  it('does not contain L3 threat model check at L2', () => {
    const out = renderTemplate(
      'docs/runbooks/prod-checklist.md.ejs',
      cfg({ governanceLevel: 'L2' }),
    )
    expect(out).not.toMatch(/STRIDE threat model/i)
  })
})

describe('docs/runbooks/deployment.md.ejs (#897, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/runbooks/deployment.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('interpolates projectName in heading and table', () => {
    const out = renderTemplate('docs/runbooks/deployment.md.ejs', cfg({ projectName: 'my-svc' }))
    expect(out).toContain('my-svc')
  })

  it('contains pre-deployment section', () => {
    const out = renderTemplate('docs/runbooks/deployment.md.ejs', cfg())
    expect(out).toMatch(/Pre-Deployment/i)
  })

  it('contains post-deployment verification section', () => {
    const out = renderTemplate('docs/runbooks/deployment.md.ejs', cfg())
    expect(out).toMatch(/Post-Deployment Verification/i)
  })

  it('contains rollback trigger criteria', () => {
    const out = renderTemplate('docs/runbooks/deployment.md.ejs', cfg())
    expect(out).toMatch(/Rollback Trigger/i)
  })
})
