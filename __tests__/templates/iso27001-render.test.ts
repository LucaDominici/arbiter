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
