import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('compliance/compliance-mapping.md.ejs (#710)', () => {
  function render(overrides: Parameters<typeof makeConfig>[1] = {}): string {
    const config = makeConfig('/tmp/test', overrides)
    return renderTemplate(
      'compliance/compliance-mapping.md.ejs',
      config as unknown as Record<string, unknown>,
    )
  }

  it('renders without EJS leaks', () => {
    const content = render({ enableIso27001Mapping: true })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('all archetypes render without error', () => {
    for (const archetype of [
      'backend-web-db',
      'cli',
      'library',
      'data-pipeline',
      'frontend-spa',
      'embedded',
    ] as const) {
      expect(() => render({ archetype, enableIso27001Mapping: true })).not.toThrow()
    }
  })

  it('contains project name', () => {
    expect(render({ enableIso27001Mapping: true })).toContain('test-project')
  })

  it('ISO 27001 section present when flag enabled', () => {
    expect(render({ enableIso27001Mapping: true })).toMatch(/ISO 27001/i)
  })

  it('NIS2 section present when flag enabled', () => {
    expect(render({ enableNis2Mapping: true })).toMatch(/NIS2|NIS 2/i)
  })

  it('GDPR section present when flag enabled', () => {
    expect(render({ enableGdprMapping: true })).toMatch(/GDPR/i)
  })

  it('maps gates to controls (PII scan → GDPR)', () => {
    const content = render({ enableGdprMapping: true })
    expect(content).toMatch(/pii.scan|pii-scan/i)
  })

  it('maps gates to controls (dependency audit → ISO 27001 A.8.8)', () => {
    const content = render({ enableIso27001Mapping: true })
    expect(content).toMatch(/audit|A\.8\.8/i)
  })
})

describe('ISO27001_ANNEX_A.md.ejs (#217)', () => {
  it('renders without EJS leaks for L3', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains A.5 Organizational Controls section', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('A.5')
    expect(rendered).toMatch(/[Oo]rganizational/)
  })

  it('contains A.8 Technological Controls section', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('A.8')
    expect(rendered).toMatch(/[Tt]echnological/)
  })

  it('pre-populates SECURE_CODING_CHECKLIST as covered (A.8.26)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('SECURE_CODING_CHECKLIST')
  })

  it('marks check-all gate as covered (A.8.25)', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toContain('check-all')
  })

  it('contains summary table with covered/gap counts', () => {
    const data = makeConfig('/tmp/test', {
      governanceLevel: 'L3',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data)
    expect(rendered).toMatch(/[Cc]overed|✅/)
    expect(rendered).toMatch(/[Gg]ap|❌/)
  })
})

// CANON-04: render tests for the ISO 27001 Annex-A controls→gate overlay template
// (#1252). The #1252 lane shipped only a generator test under __tests__/generators/;
// this block, added at M4-overlay integration (#1248), restores parity with the gdpr
// (#1251) and iso9001 (#1253) render tests and keeps the template-tests ratchet honest.
describe('audit/iso27001/iso27001-controls-gate-map.md.ejs (CANON-04, #1252)', () => {
  function renderOverlay(): string {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      industryOverlay: 'iso27001',
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
    return renderTemplate('audit/iso27001/iso27001-controls-gate-map.md.ejs', data)
  }

  it('renders without unrendered EJS markers', () => {
    const out = renderOverlay()
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('binds the enforceable Annex-A controls to fail-closed gates', () => {
    const out = renderOverlay()
    for (const control of ['A.8.25', 'A.8.26', 'A.8.28', 'A.8.29', 'A.8.32']) {
      expect(out).toContain(control)
    }
    expect(out).toContain('INV-119')
    expect(out).toContain('gitleaks')
  })

  it('interpolates project + overlay context without leaking undefined', () => {
    const out = renderOverlay()
    expect(out).not.toContain('undefined')
    expect(out).toContain('industryOverlay: iso27001')
  })
})
