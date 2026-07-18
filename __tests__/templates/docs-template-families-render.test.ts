// SPDX-License-Identifier: Apache-2.0
// Render tests for docs/{steering,specs,bugs}/*.md.ejs — CANON-04 compliance (#1268).
// Re-derived spec-kit families: steering docs, atomic-task-list, bug triage/verification.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('docs/steering/structure.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/steering/structure.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('interpolates projectName', () => {
    const out = renderTemplate('docs/steering/structure.md.ejs', cfg({ projectName: 'my-svc' }))
    expect(out).toContain('my-svc')
  })
  it('describes module/directory structure', () => {
    const out = renderTemplate('docs/steering/structure.md.ejs', cfg())
    expect(out).toMatch(/Structure|Directory|Module|Boundaries/i)
  })
})

describe('docs/steering/tech.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/steering/tech.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('reflects the configured language', () => {
    const out = renderTemplate('docs/steering/tech.md.ejs', cfg({ language: 'typescript' }))
    expect(out).toMatch(/typescript/i)
  })
  it('lists build/test/lint commands', () => {
    const out = renderTemplate(
      'docs/steering/tech.md.ejs',
      cfg({ buildCommand: 'npm run build', testCommand: 'npm test' }),
    )
    expect(out).toContain('npm run build')
    expect(out).toContain('npm test')
  })
})

describe('docs/steering/product.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/steering/product.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('interpolates projectName', () => {
    const out = renderTemplate('docs/steering/product.md.ejs', cfg({ projectName: 'my-svc' }))
    expect(out).toContain('my-svc')
  })
  it('contains product context sections', () => {
    const out = renderTemplate('docs/steering/product.md.ejs', cfg())
    expect(out).toMatch(/Users|Problem|Value|Scope/i)
  })
})

describe('docs/specs/atomic-task-list.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/specs/atomic-task-list.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('interpolates projectName', () => {
    const out = renderTemplate('docs/specs/atomic-task-list.md.ejs', cfg({ projectName: 'my-svc' }))
    expect(out).toContain('my-svc')
  })
  it('defines atomic-task criteria', () => {
    const out = renderTemplate('docs/specs/atomic-task-list.md.ejs', cfg())
    expect(out).toMatch(/atomic/i)
    expect(out).toMatch(/Acceptance|acceptance criteria/i)
  })
  it('references TDD red-green', () => {
    const out = renderTemplate('docs/specs/atomic-task-list.md.ejs', cfg())
    expect(out).toMatch(/TDD|red.*green|failing test/i)
  })
})

describe('docs/bugs/bug-analysis.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/bugs/bug-analysis.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('contains root-cause analysis sections', () => {
    const out = renderTemplate('docs/bugs/bug-analysis.md.ejs', cfg())
    expect(out).toMatch(/Root Cause|Hypothesis|Reproduction/i)
  })
})

describe('docs/bugs/bug-report.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/bugs/bug-report.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('contains expected vs actual sections', () => {
    const out = renderTemplate('docs/bugs/bug-report.md.ejs', cfg())
    expect(out).toMatch(/Expected/i)
    expect(out).toMatch(/Actual/i)
    expect(out).toMatch(/Steps to Reproduce|Reproduce/i)
  })
})

describe('docs/bugs/bug-verification.md.ejs (#1268, CANON-04)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('docs/bugs/bug-verification.md.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
  it('aligns with the DEBUG_STATE evidence artifact', () => {
    const out = renderTemplate('docs/bugs/bug-verification.md.ejs', cfg())
    expect(out).toContain('DEBUG_STATE')
    expect(out).toMatch(/\.evidence/)
  })
  it('contains a verification checklist', () => {
    const out = renderTemplate('docs/bugs/bug-verification.md.ejs', cfg())
    expect(out).toMatch(/Verification|Regression test|fix verified/i)
  })
})
