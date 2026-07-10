import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderSharedSecurity(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_shared-security.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('_shared-security.yml.ejs — structural invariants (#1694, CANON-18)', () => {
  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderSharedSecurity({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains dast-full job', () => {
    const rendered = renderSharedSecurity({ language: 'typescript' })
    expect(rendered).toContain('dast-full:')
  })

  it('contains dep-cve-refresh job', () => {
    const rendered = renderSharedSecurity({ language: 'typescript' })
    expect(rendered).toContain('dep-cve-refresh:')
  })

  it('dast-full has continue-on-error: true (informational — must not block gate)', () => {
    const rendered = renderSharedSecurity({ language: 'typescript' })
    expect(rendered).toContain('continue-on-error: true')
  })

  it('dep-cve-refresh does NOT have continue-on-error (must remain gate-blocking)', () => {
    // continue-on-error appears only once — in the dast-full job
    const rendered = renderSharedSecurity({ language: 'typescript' })
    const count = (rendered.match(/continue-on-error: true/g) ?? []).length
    expect(count).toBe(1)
  })

  it('Java: renders Trivy fs dependency scan in dep-cve-refresh (ADR-104)', () => {
    const rendered = renderSharedSecurity({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('Trivy fs')
  })

  it('Java: Trivy fs is a composite action, not the docker-container OWASP DC action (ADR-104, #1785)', () => {
    // ADR-104: OWASP Dependency-Check (and its docker-container
    // dependency-check/Dependency-Check_Action wrapper, #1785) was replaced by Trivy
    // fs (aquasecurity/trivy-action) — a composite action with no workspace
    // bind-mount, never subject to the #1785 defect class in the first place.
    const rendered = renderSharedSecurity({ language: 'java', buildTool: 'gradle' })
    expect(rendered).not.toMatch(/uses:\s*dependency-check\/Dependency-Check_Action/)
    expect(rendered).not.toContain('OWASP Dependency-Check')
    expect(rendered).toMatch(/uses:\s*aquasecurity\/trivy-action@/)
    expect(rendered).toMatch(/scan-type:\s*fs/)
    expect(rendered).toMatch(/trivyignores:\s*\.trivyignore/)
  })

  it('TypeScript: renders npm audit in dep-cve-refresh', () => {
    const rendered = renderSharedSecurity({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('npm audit')
  })

  it('non-service archetype: dast-full has if: false guard', () => {
    const rendered = renderSharedSecurity({ archetype: 'library' })
    expect(rendered).toContain('if: false')
  })

  it('service archetype: dast-full does NOT have if: false guard', () => {
    const rendered = renderSharedSecurity({ archetype: 'backend-web-db' })
    const lines = rendered.split('\n')
    const dastIdx = lines.findIndex((l) => l.includes('dast-full:'))
    const depCveIdx = lines.findIndex((l) => l.includes('dep-cve-refresh:'))
    const dastSection = lines.slice(dastIdx, depCveIdx).join('\n')
    expect(dastSection).not.toContain('if: false')
  })

  it('has workflow_call trigger with no inputs (R-07 — nvd-cache-namespace was dead)', () => {
    const rendered = renderSharedSecurity({ language: 'typescript' })
    expect(rendered).toContain('workflow_call:')
    expect(rendered).not.toContain('nvd-cache-namespace')
  })
})
