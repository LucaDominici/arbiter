import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// Covers: src/templates/scripts/check-constraint-scan.mjs.ejs (INV-115, #1214)
// Dual-sided parity (CANON-01/14): the emitted twin mirrors scripts/check-constraint-scan.mjs,
// differing only in the ENFORCE_DEFAULT default (warn on targets, hard-fail in the self repo).
function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const TEMPLATE = 'scripts/check-constraint-scan.mjs.ejs'

describe('check-constraint-scan.mjs.ejs render (INV-115)', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('renders across archetypes without error', () => {
    for (const archetype of ['backend-web-db', 'cli', 'library', 'frontend-spa'] as const) {
      expect(() => renderTemplate(TEMPLATE, cfg({ archetype }))).not.toThrow()
    }
  })

  it('target default is WARN (ENFORCE_DEFAULT = false), not hard-fail on init', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    expect(out).toContain('const ENFORCE_DEFAULT = false')
  })

  it('the self repo gate is the opposite default (ENFORCE_DEFAULT = true)', () => {
    const selfSrc = readFileSync(resolve('scripts/check-constraint-scan.mjs'), 'utf8')
    expect(selfSrc).toContain('const ENFORCE_DEFAULT = true')
  })

  it('preserves the classification core (parity with the self gate)', () => {
    const out = renderTemplate(TEMPLATE, cfg())
    for (const marker of [
      'function extractProhibitions',
      'function isDerivable',
      'function enforcerExists',
      'MAP-FICTION',
      'UNENFORCEABLE',
      'escapeRegExp',
    ]) {
      expect(out).toContain(marker)
    }
  })

  it('classification logic matches the self gate token-for-token (modulo comments + ENFORCE_DEFAULT + CANON path)', () => {
    // Strongest parity guard: strip comments and the two differing defaults, then collapse
    // whitespace and compare the executable token-stream. Whitespace-tolerant because Prettier
    // formats the self .mjs but not the .ejs twin; still catches any logic/identifier drift
    // inside any function — which a marker-string check cannot.
    // CANON path diverges by design: the self repo keeps CANON.md under docs/internal/
    // (public/internal docs split, #1770); generated targets keep docs/SYSTEM/CANON.md.
    const normalise = (s: string): string =>
      s
        .split('\n')
        .map((l) => l.replace(/\s*\/\/.*$/, '')) // strip full-line AND trailing comments
        .map((l) => l.replace(/const ENFORCE_DEFAULT = (true|false)/, 'const ENFORCE_DEFAULT = X'))
        .map((l) => l.replace(/docs\/internal\/SYSTEM\/CANON\.md/g, 'docs/SYSTEM/CANON.md'))
        .join('\n')
        .replace(/\s+/g, '') // strip ALL whitespace → Prettier line-wrapping insensitive
        .replace(/,(?=[)\]}])/g, '') // drop Prettier trailing commas (semantically insignificant)
        .trim()
    const rendered = normalise(renderTemplate(TEMPLATE, cfg()))
    const self = normalise(readFileSync(resolve('scripts/check-constraint-scan.mjs'), 'utf8'))
    expect(rendered).toBe(self)
  })
})
