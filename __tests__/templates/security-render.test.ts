import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

// ─── ZAP DAST templates (#898) ────────────────────────────────────────────────

describe('ZAP DAST template rendering (#898)', () => {
  describe('security/zap/rules.tsv.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('security/zap/rules.tsv.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('contains tab-separated columns header comment', () => {
      const out = renderTemplate('security/zap/rules.tsv.ejs', cfg())
      expect(out).toContain('# id')
    })

    it('contains at least one rule row with tab separators', () => {
      const out = renderTemplate('security/zap/rules.tsv.ejs', cfg())
      // Each row must have exactly 3 tabs (4 columns)
      const rows = out.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row).toContain('\t')
      }
    })

    it('contains known high-signal rule IDs', () => {
      const out = renderTemplate('security/zap/rules.tsv.ejs', cfg())
      expect(out).toContain('10010') // Secure pages include mixed content
      expect(out).toContain('10202') // Absence of Anti-CSRF Tokens
    })

    it('action column values are valid', () => {
      const out = renderTemplate('security/zap/rules.tsv.ejs', cfg())
      const rows = out.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
      for (const row of rows) {
        const cols = row.split('\t')
        expect(cols.length).toBe(4)
        expect(['IGNORE', 'WARN', 'FAIL']).toContain(cols[1])
      }
    })
  })

  describe('security/zap/baseline-auth.context.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('is valid XML envelope', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).toContain('<Context>')
      expect(out).toContain('</Context>')
    })

    it('contains authentication block with form-based type', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      // type 2 = form-based authentication in ZAP
      expect(out).toContain('<type>2</type>')
    })

    it('contains login URL placeholder', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).toContain('loginUrl')
    })

    it('contains users block', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).toContain('<users>')
      expect(out).toContain('</users>')
    })

    it('contains session management block', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).toContain('<sessionManagement>')
    })

    it('interpolates projectName into context name', () => {
      const out = renderTemplate('security/zap/baseline-auth.context.ejs', cfg())
      expect(out).toContain('test-project')
    })
  })

  describe('scripts/ingest-zap-report.mjs.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('is a node script with shebang', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      expect(out).toContain('#!/usr/bin/env node')
    })

    it('reads a ZAP JSON report file', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      expect(out).toContain('zap-report.json')
    })

    it('fails on HIGH alerts above threshold', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      // riskcode 3 = High in ZAP JSON
      expect(out).toContain('riskcode')
      expect(out).toContain('process.exit(1)')
    })

    it('fails on MEDIUM alerts above threshold', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      // riskcode 2 = Medium in ZAP JSON
      expect(out).toContain('riskcode')
    })

    it('prints a summary of failing alerts', () => {
      const out = renderTemplate('scripts/ingest-zap-report.mjs.ejs', cfg())
      expect(out).toContain('[ZAP]')
    })
  })

  // #1887-E: the script's own header comment documents zap-full-report and
  // action-baseline-scan as its two producers — neither workflow actually
  // wired the ingest step (or a JSON report filename for the scanner to write
  // to), so the "gate" it advertises was dead on every project. This is the
  // workflow-side half: step exists, path matches the emission gate
  // (archetype === 'backend-web-db' && enableSecurityScanning) generateSecurity
  // uses for scripts/ingest-zap-report.mjs itself.
  describe('workflow wiring — ingest-zap-report.mjs step (#1887-E)', () => {
    const zapConfig = () => cfg({ archetype: 'backend-web-db', enableSecurityScanning: true })

    it('_shared-security.yml.ejs: dast-full wires cmd_options + the ingest step', () => {
      const out = renderTemplate('github/workflows/_shared-security.yml.ejs', zapConfig())
      expect(out).toContain("cmd_options: '-J zap-report.json'")
      expect(out).toContain('node scripts/ingest-zap-report.mjs --report zap-report.json')
    })

    it('_shared-security.yml.ejs: omits the ingest step when enableSecurityScanning is false (never emitted there)', () => {
      const out = renderTemplate(
        'github/workflows/_shared-security.yml.ejs',
        cfg({ archetype: 'backend-web-db', enableSecurityScanning: false }),
      )
      expect(out).not.toContain('ingest-zap-report.mjs')
    })

    it('04-deploy-test.yml.ejs: dast-baseline wires context_file + cmd_options + the ingest step', () => {
      const out = renderTemplate('github/workflows/04-deploy-test.yml.ejs', {
        ...zapConfig(),
        deployTarget: 'azure-container-app',
      })
      expect(out).toContain("context_file: '.zap/baseline-auth.context'")
      expect(out).toContain("cmd_options: '-J zap-report.json'")
      expect(out).toContain('node scripts/ingest-zap-report.mjs --report zap-report.json')
    })

    it('04-deploy-test.yml.ejs: omits the ingest step when enableSecurityScanning is false (never emitted there)', () => {
      const out = renderTemplate('github/workflows/04-deploy-test.yml.ejs', {
        ...cfg({ archetype: 'backend-web-db', enableSecurityScanning: false }),
        deployTarget: 'azure-container-app',
      })
      expect(out).not.toContain('ingest-zap-report.mjs')
    })
  })
})

describe('security template rendering (#166)', () => {
  describe('STRIDE.md.ejs', () => {
    it('renders without EJS leaks', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).not.toContain('<%')
      expect(out).not.toContain('%>')
    })

    it('interpolates projectName in heading', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('test-project')
    })

    it('contains STRIDE heading', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('STRIDE')
    })

    it('contains threat category columns', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('Category')
      expect(out).toContain('Severity')
      expect(out).toContain('Mitigation')
    })

    it('contains threat register table', () => {
      const out = renderTemplate('security/STRIDE.md.ejs', cfg())
      expect(out).toContain('Threat Register')
    })
  })
})
