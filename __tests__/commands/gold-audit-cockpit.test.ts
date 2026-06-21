// SPDX-License-Identifier: Apache-2.0
// TDD: the rich goldness cockpit renderer (#1475, epic #1469). Pure render over the engine payload
// + out-of-band freshness — three byte-deterministic tiers (TTY / piped / --ascii).
import { describe, it, expect } from 'vitest'
import {
  renderCockpit,
  type GoldAuditPayload,
  type FreshnessInfo,
} from '../../src/commands/gold-audit.js'

const PAYLOAD: GoldAuditPayload = {
  registryVersion: '1.0.0',
  score: 62,
  yCount: 5,
  riskyCount: 1,
  totals: { checks: 6, y: 5, p: 1, n: 1, na: 1, nv: 1 },
  dimensions: { 'D-A': { score: 50, y: 2 }, 'D-B': { score: 75, y: 3 } },
  checks: [
    {
      id: 'A-1',
      dimension: 'D-A',
      title: '',
      type: 'file_exists',
      verdict: 'Y',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
    {
      id: 'A-2',
      dimension: 'D-A',
      title: '',
      type: 'file_exists',
      verdict: 'N',
      weight: 1,
      risk: 'RISKY',
      anchor: null,
      evidence: null,
    },
    {
      id: 'A-3',
      dimension: 'D-A',
      title: '',
      type: 'manual',
      verdict: 'NV',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
    {
      id: 'B-1',
      dimension: 'D-B',
      title: '',
      type: 'file_exists',
      verdict: 'Y',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
    {
      id: 'B-2',
      dimension: 'D-B',
      title: '',
      type: 'file_exists',
      verdict: 'P',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
    {
      id: 'B-3',
      dimension: 'D-B',
      title: '',
      type: 'file_exists',
      verdict: 'NA',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
  ],
  level: {
    level: 'L1',
    nextLevel: 'L2',
    toNextLevel: 13,
    brownfieldClass: 'gold',
    thresholds: [50, 75, 95],
  },
  gaps: [],
}

const FRESH: FreshnessInfo = {
  status: 'PARTIAL',
  counts: { total: 3, present: 2, fresh: 1 },
  staleHours: 24,
}

const ESC = '\x1b'

describe('renderCockpit (#1475)', () => {
  it('piped tier: unicode glyphs, ZERO ANSI, byte-deterministic', () => {
    const out = renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })
    expect(out).not.toContain(ESC) // no ANSI when piped
    expect(out).toContain('🟢') // unicode Y glyph
    expect(out).toContain('DIMENSIONS')
    expect(out).toContain('D-A')
    // two renders are byte-identical
    expect(renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })).toBe(out)
  })

  it('--ascii tier: PURE ASCII (no unicode, no ANSI)', () => {
    const out = renderCockpit(PAYLOAD, FRESH, { color: false, ascii: true })
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(out)).toBe(false) // every byte is ASCII
    expect(out).not.toContain(ESC)
    expect(out).toMatch(/\bY\b/) // ASCII Y glyph
    expect(out).toContain('#') // ASCII bar fill
  })

  it('TTY tier: emits ANSI colour escapes + unicode glyphs', () => {
    const out = renderCockpit(PAYLOAD, FRESH, { color: true, ascii: false })
    expect(out).toContain(ESC) // ANSI present
    expect(out).toContain('🟢')
  })

  it('NV renders DISTINCTLY from NA (anti-fake-green) in both glyph sets', () => {
    const uni = renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })
    expect(uni).toContain('❔') // NV glyph
    expect(uni).toContain('·') // NA glyph
    expect('❔').not.toBe('·')
    const asc = renderCockpit(PAYLOAD, FRESH, { color: false, ascii: true })
    expect(asc).toContain('?') // NV ascii
    expect(asc).toContain('.') // NA ascii
  })

  it('shows the RISKY row when riskyCount > 0, hides it when 0', () => {
    expect(renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })).toContain('RISKY: 1')
    const safe = { ...PAYLOAD, riskyCount: 0 }
    expect(renderCockpit(safe, FRESH, { color: false, ascii: false })).not.toContain('RISKY:')
  })

  it('shows the freshness banner when reports are declared, hides it otherwise', () => {
    expect(renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })).toContain('DATA PARTIAL')
    // no freshness (null) ⇒ no banner
    expect(renderCockpit(PAYLOAD, null, { color: false, ascii: false })).not.toContain('DATA')
    // total 0 ⇒ no banner (nothing to be fresh/stale about)
    const empty: FreshnessInfo = {
      status: 'FRESH',
      counts: { total: 0, present: 0, fresh: 0 },
      staleHours: 24,
    }
    expect(renderCockpit(PAYLOAD, empty, { color: false, ascii: false })).not.toContain('DATA')
  })

  it('SANITIZES untrusted ids — no ANSI/newline injection survives into piped or --ascii output', () => {
    // The gold-registry is project-authored (untrusted in a consumer repo); a crafted dimension id
    // must NEVER inject an ANSI escape or forge a line into piped/CI/committed output.
    const evil: GoldAuditPayload = {
      ...PAYLOAD,
      dimensions: {
        'D-\x1b[31mEVIL\x1b[0m': { score: 50, y: 1 },
        'D\nFAKE L3 (gold) score 100': { score: 0, y: 0 },
      },
      checks: [
        {
          id: 'X',
          dimension: 'D-\x1b[31mEVIL\x1b[0m',
          title: '',
          type: 'file_exists',
          verdict: 'N',
          weight: 1,
          risk: 'SAFE',
          anchor: null,
          evidence: null,
        },
      ],
    }
    for (const ascii of [false, true]) {
      const out = renderCockpit(evil, null, { color: false, ascii })
      expect(out).not.toContain('\x1b') // no injected ANSI in a non-color tier
      // the embedded newline is stripped, so the forged text cannot become its own (level-looking) line
      expect(out.split('\n').some((l) => l.trimStart().startsWith('FAKE L3'))).toBe(false)
    }
  })

  it('does NOT drop a check whose dimension is absent from payload.dimensions (anti-fake-green)', () => {
    const orphan: GoldAuditPayload = {
      ...PAYLOAD,
      checks: [
        ...PAYLOAD.checks,
        {
          id: 'O-1',
          dimension: 'D-ORPHAN',
          title: '',
          type: 'file_exists',
          verdict: 'N',
          weight: 1,
          risk: 'SAFE',
          anchor: null,
          evidence: null,
        },
      ],
    }
    const out = renderCockpit(orphan, null, { color: false, ascii: false })
    expect(out).toContain('D-ORPHAN') // the orphan dimension is rendered, its N not hidden
  })

  it('a prototype-key verdict/status falls back to NA — no literal "undefined", no broken ANSI', () => {
    for (const bad of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      const p = {
        ...PAYLOAD,
        dimensions: { 'D-A': { score: 50, y: 0 } },
        checks: [
          {
            id: 'X',
            dimension: 'D-A',
            title: '',
            type: 'manual',
            verdict: bad,
            weight: 1,
            risk: 'SAFE',
            anchor: null,
            evidence: null,
          },
        ],
      } as unknown as GoldAuditPayload
      const status = {
        status: bad,
        counts: { total: 2, present: 1, fresh: 1 },
        staleHours: 24,
      } as unknown as FreshnessInfo
      const out = renderCockpit(p, status, { color: true, ascii: false })
      expect(out).not.toContain('undefined')
      expect(out).not.toContain('[object Object]')
      expect(out).toContain('·') // NA glyph fallback
    }
  })

  it('SANITIZES level.nextLevel — no ANSI/forged line via a crafted nextLevel', () => {
    const evil = {
      ...PAYLOAD,
      level: { ...PAYLOAD.level, nextLevel: '\x1b[31mL2\x1b[0m\nFAKE L3 (gold) score 100' },
    } as unknown as GoldAuditPayload
    for (const ascii of [false, true]) {
      const out = renderCockpit(evil, null, { color: false, ascii })
      expect(out).not.toContain('\x1b')
      expect(out.split('\n').some((l) => l.trimStart().startsWith('FAKE L3'))).toBe(false)
    }
  })

  it('--ascii folds untrusted UNICODE in ids/level/status to pure ASCII', () => {
    const uni: GoldAuditPayload = {
      ...PAYLOAD,
      dimensions: { 'D-日本語': { score: 50, y: 1 } },
      level: {
        ...PAYLOAD.level,
        brownfieldClass: 'góld' as GoldAuditPayload['level']['brownfieldClass'],
      },
      checks: [
        {
          id: 'X',
          dimension: 'D-日本語',
          title: '',
          type: 'file_exists',
          verdict: 'Y',
          weight: 1,
          risk: 'SAFE',
          anchor: null,
          evidence: null,
        },
      ],
    }
    const fresh: FreshnessInfo = {
      status: 'PÁRTIAL' as FreshnessInfo['status'],
      counts: { total: 1, present: 1, fresh: 1 },
      staleHours: 24,
    }
    const out = renderCockpit(uni, fresh, { color: false, ascii: true })
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(out)).toBe(false)
  })

  it('coerces a smuggled string in a numeric field (no ANSI/forged line)', () => {
    const bad = {
      ...PAYLOAD,
      riskyCount: 1,
      yCount: '\x1b[31m5\nFORGED',
    } as unknown as GoldAuditPayload
    const fresh = {
      status: 'STALE',
      counts: { total: '\x1b[31m2\nFAKE', present: 0, fresh: 0 },
      staleHours: '24\nROW',
    } as unknown as FreshnessInfo
    const out = renderCockpit(bad, fresh, { color: false, ascii: false })
    expect(out).not.toContain('\x1b')
    expect(
      out
        .split('\n')
        .some(
          (l) =>
            l.trimStart().startsWith('FORGED') ||
            l.trimStart().startsWith('FAKE') ||
            l.trimStart().startsWith('ROW'),
        ),
    ).toBe(false)
  })

  it('folds an OBJECT-valued string field — no literal "[object", no "undefined", never throws', () => {
    // A malformed --cockpit-data envelope can put a JSON object/array where a scalar string belongs
    // (JSON-reachable, surviving JSON.parse). String coercion would leak "[object Object]" or — for a
    // primitive-resisting value like {"toString":null} — throw "Cannot convert object to primitive".
    const objectValues: unknown[] = [{}, { a: 1 }, [{ x: 1 }], JSON.parse('{"toString":null}')]
    const set = (field: string, v: unknown): { p: GoldAuditPayload; f: FreshnessInfo } => {
      const p = JSON.parse(JSON.stringify(PAYLOAD)) as GoldAuditPayload
      const f = JSON.parse(JSON.stringify(FRESH)) as FreshnessInfo
      const lvl = p.level as unknown as Record<string, unknown>
      if (field === 'level') lvl['level'] = v
      else if (field === 'nextLevel') lvl['nextLevel'] = v
      else if (field === 'brownfieldClass') lvl['brownfieldClass'] = v
      else if (field === 'dimension')
        (p.checks[0] as unknown as Record<string, unknown>)['dimension'] = v
      else if (field === 'verdict')
        (p.checks[0] as unknown as Record<string, unknown>)['verdict'] = v
      else if (field === 'status') (f as unknown as Record<string, unknown>)['status'] = v
      return { p, f }
    }
    for (const field of [
      'level',
      'nextLevel',
      'brownfieldClass',
      'dimension',
      'verdict',
      'status',
    ]) {
      for (const v of objectValues) {
        const { p, f } = set(field, v)
        for (const tier of [
          { color: false, ascii: false },
          { color: true, ascii: false },
          { color: false, ascii: true },
        ]) {
          let out = ''
          expect(() => {
            out = renderCockpit(p, f, tier)
          }).not.toThrow()
          expect(out).not.toContain('[object')
          expect(out).not.toContain('undefined')
        }
      }
    }
  })

  it('renders a corrupt (NaN/Infinity) score visibly, not blank, and never crashes', () => {
    const bad = { ...PAYLOAD, score: NaN, dimensions: { 'D-A': { score: Infinity, y: 0 } } }
    const out = renderCockpit(bad as unknown as GoldAuditPayload, null, {
      color: false,
      ascii: false,
    })
    expect(out).toContain('score 0') // NaN clamps to 0
    expect(out).not.toContain('NaN')
    expect(out).not.toContain('Infinity')
  })

  it('renders the level band + score bar + a glyph strip per dimension', () => {
    const out = renderCockpit(PAYLOAD, FRESH, { color: false, ascii: false })
    expect(out).toContain('L1 (gold)')
    expect(out).toContain('score 62')
    expect(out).toContain('13 to L2')
    expect(out).toMatch(/legend:/)
  })
})
