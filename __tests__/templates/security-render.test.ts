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
