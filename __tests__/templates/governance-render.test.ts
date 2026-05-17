import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('governance template rendering (#166, #712)', () => {
  describe('risk-register.md.ejs (#712)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
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
        expect(() =>
          renderTemplate('governance/risk-register.md.ejs', cfg({ archetype })),
        ).not.toThrow()
      }
    })

    it('contains project name', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains P×I matrix', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/Probability.*Impact|P.*×.*I/i)
    })

    it('contains ISO 27001 reference', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/ISO 27001|§6\.1\.2/i)
    })

    it('contains risk classification tiers', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/Critical|High|Medium|Low/i)
    })

    it('contains at least one pre-populated risk entry', () => {
      const out = renderTemplate('governance/risk-register.md.ejs', cfg())
      expect(out).toMatch(/R-\d+/)
    })
  })

  describe('risk-assessment-template.md.ejs (#712)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('contains probability and impact fields', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Probability|probability/i)
      expect(out).toMatch(/Impact|impact/i)
    })

    it('contains score calculation guidance', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Score|score|P.*×.*I/i)
    })

    it('contains mitigation section', () => {
      const out = renderTemplate('governance/risk-assessment-template.md.ejs', cfg())
      expect(out).toMatch(/Mitigation|mitigation/i)
    })
  })

  describe('qa-audit-phases.md.ejs (#727)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains six default phases 01..06', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      for (const id of ['01', '02', '03', '04', '05', '06']) {
        expect(out).toMatch(new RegExp(`### Phase ${id} —`))
      }
    })

    it('contains schema example with required fields', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toMatch(/"phase":/)
      expect(out).toMatch(/"rerun":/)
      expect(out).toMatch(/"cadence":/)
      expect(out).toMatch(/"severity_thresholds":/)
    })

    it('contains arbiter audit run CLI signature', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toMatch(/arbiter audit run/)
    })

    it('contains cadence cron mapping', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toMatch(/Cron schedule/)
      expect(out).toMatch(/weekly/)
      expect(out).toMatch(/monthly/)
    })

    it('contains anti-patterns and NI-4 reference', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toMatch(/Anti-patterns/i)
      expect(out).toMatch(/NI-4/)
    })

    it('contains opt-in flag governance.qa_audit_phases', () => {
      const out = renderTemplate('governance/qa-audit-phases.md.ejs', cfg())
      expect(out).toMatch(/governance.*qa_audit_phases/)
    })
  })

  describe('contract-integrity-policy.md.ejs (#716)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains all five gates A-E', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).toMatch(/Gate A — OpenAPI snapshot/)
      expect(out).toMatch(/Gate B — DTO parity/)
      expect(out).toMatch(/Gate C — Operation smoke/)
      expect(out).toMatch(/Gate D — Dead code/)
      expect(out).toMatch(/Gate E — Test hygiene/)
    })

    it('contains distinct-from-Pact section', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).toMatch(/Distinct from Pact/)
      expect(out).toMatch(/M28/)
    })

    it('contains all five opt-in flag names', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).toContain('openapi_snapshot')
      expect(out).toContain('dto_parity')
      expect(out).toContain('operation_smoke')
      expect(out).toContain('dead_code')
      expect(out).toContain('test_hygiene')
    })

    it('contains adoption-order recommendation', () => {
      const out = renderTemplate('governance/contract-integrity-policy.md.ejs', cfg())
      expect(out).toMatch(/adoption order/i)
    })
  })

  describe('gdpr-erasure-runbook.md.ejs (#713)', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('lists all 14 cascade steps', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      for (let i = 1; i <= 14; i++) {
        expect(out).toMatch(new RegExp(`### ${i}\\. `))
      }
    })

    it('includes the Keycloak DELETE fix (M-05 audit)', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).toMatch(/Keycloak/)
      expect(out).toMatch(/DELETE.*\/admin\/realms/)
      expect(out).toMatch(/NOT disable/)
    })

    it('contains multi-stack hook stubs (TS + Java + Go)', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).toContain('TS / Express')
      expect(out).toContain('Java / Spring')
      expect(out).toContain('Go / chi')
    })

    it('contains anti-patterns section', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).toMatch(/Anti-patterns/i)
      expect(out).toMatch(/Soft-delete-only/i)
    })

    it('contains opt-in flag', () => {
      const out = renderTemplate('governance/gdpr-erasure-runbook.md.ejs', cfg())
      expect(out).toMatch(/compliance.*gdpr_erasure/)
    })
  })

  describe('RACI.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains RACI role columns', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('Accountable')
      expect(out).toContain('Responsible')
      expect(out).toContain('Consulted')
      expect(out).toContain('Informed')
    })

    it('contains enterprise-compliance-baseline rendering (#711)', () => {
      const out = renderTemplate('governance/enterprise-compliance-baseline.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
      expect(out).toContain('test-project')
      expect(out).toMatch(/Art\.\s*6/)
      expect(out).toMatch(/Art\.\s*17/)
      expect(out).toMatch(/Art\.\s*32/)
      expect(out).toContain('NIS2')
      expect(out).toMatch(/24h/)
      expect(out).toContain('ISO 27001')
      expect(out).toContain('A01:')
      expect(out).toContain('A10:')
      expect(out).toContain('[FILL')
      expect(out).toMatch(/compliance.*enterprise_baseline/)
    })

    it('contains responsibility matrix heading', () => {
      const out = renderTemplate('governance/RACI.md.ejs', cfg())
      expect(out).toContain('Responsibility Matrix')
    })
  })
})
