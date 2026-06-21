// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/explain.ts (#1486).
 *
 * `runExplain` is a pure dispatcher over four read-only catalogs (INVARIANT,
 * ERROR, CANON-from-docs/SYSTEM/CANON.md, and the in-module FLAG_CATALOG). There
 * is no spawn / git / gh / fs-write / process.exit side effect to stub — the only
 * I/O is `loadCanonEntries` reading the repo's own committed CANON.md, which is
 * deterministic. So these tests exercise the remaining UNCOVERED branches with
 * real catalog data instead of mocks:
 *
 *   - the no-code/no-list usage-error early return,
 *   - the unknown-code JSON-vs-text branch,
 *   - the `ERROR_CATALOG.has(normalized)` right operand of the `||` (a code that
 *     is in the catalog yet still routes through the E_ prefix),
 *   - INV text/JSON with enforcement PRESENT (INV-07) vs ABSENT (INV-56, the
 *     `if (inv.enforcement)` false side + the JSON `enforcement ?? ''` fallback),
 *   - the `alwaysActive ? 'yes' : 'no'` ternary both ways (INV-01 true, INV-07 false),
 *   - CANON text/JSON with both optional fields (CANON-02: sourceIssues+promotedTo)
 *     and with promotedTo ABSENT (CANON-01: the `if (entry.promotedTo)` false side),
 *   - ERROR text/JSON with docUrl present,
 *   - FLAG JSON payload (full field assertion) and the case-insensitive resolve,
 *   - listAll JSON item-shape for every category.
 *
 * The `if (entry.docUrl)` FALSE branch in explainError and the `!entry` guards in
 * explainFlag/explainInv/explainCanon/explainError are unreachable without a
 * source edit (every real ERROR entry has a docUrl; resolveFlagCode/`.find`
 * guarantee the entry exists before the helper is called), so they are
 * intentionally left uncovered here.
 */
import { describe, it, expect } from 'vitest'
import { runExplain } from '../../src/commands/explain.js'
import type { ExplainResult } from '../../src/commands/explain.js'

describe('explain.cov: runExplain top-level dispatch branches', () => {
  it('empty code with no --list returns the usage error (exit 1, stderr)', () => {
    const result: ExplainResult = runExplain('', {})
    expect(result.exitCode).toBe(1)
    expect(result.output).toBe('')
    expect(result.error).toContain('Usage: arbiter explain')
    expect(result.error).toContain('--list')
  })

  it('unknown code with --format json returns a JSON error payload (exit 1)', () => {
    const result: ExplainResult = runExplain('TOTALLY_UNKNOWN_XYZ', { format: 'json' })
    expect(result.exitCode).toBe(1)
    expect(result.error).toBe('')
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.error).toBe('Unknown code: TOTALLY_UNKNOWN_XYZ')
  })

  it('unknown code in text mode returns stderr (not JSON) suggesting --list', () => {
    const result: ExplainResult = runExplain('TOTALLY_UNKNOWN_XYZ', {})
    expect(result.exitCode).toBe(1)
    expect(result.output).toBe('')
    expect(result.error).toContain('Unknown code: TOTALLY_UNKNOWN_XYZ')
    expect(result.error).toContain('--list')
  })

  it('routes via the E_ prefix even when given lowercase (normalized + has)', () => {
    // `e_config_not_found` lowercases to a non-FLAG, non-INV, non-CANON code;
    // normalized = E_CONFIG_NOT_FOUND startsWith('E_') routes to explainError.
    const result: ExplainResult = runExplain('e_config_not_found', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('E_CONFIG_NOT_FOUND')
  })
})

describe('explain.cov: INV enforcement + alwaysActive branches', () => {
  it('INV-56 (no enforcement) text omits the Enforcement line and renders yes', () => {
    // INV-56 has alwaysActive: true and NO enforcement field — hits the
    // `if (inv.enforcement)` FALSE branch and the `? 'yes'` ternary side.
    const result: ExplainResult = runExplain('INV-56', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('INV-56')
    expect(result.output).not.toContain('Enforcement:')
    expect(result.output).toContain('Always active: yes')
  })

  it('INV-56 JSON uses the empty-string enforcement fallback', () => {
    const result: ExplainResult = runExplain('INV-56', { format: 'json' })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.code).toBe('INV-56')
    expect(parsed.category).toBe('INV')
    expect(parsed.enforcement).toBe('')
    expect(parsed.alwaysActive).toBe(true)
  })

  it('INV-07 (alwaysActive false, has enforcement) renders no + Enforcement line', () => {
    const result: ExplainResult = runExplain('INV-07', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('INV-07')
    expect(result.output).toContain('Enforcement:')
    expect(result.output).toContain('Always active: no')
  })

  it('INV-07 JSON carries a non-empty enforcement and alwaysActive false', () => {
    const result: ExplainResult = runExplain('INV-07', { format: 'json' })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.alwaysActive).toBe(false)
    expect(typeof parsed.enforcement).toBe('string')
    expect((parsed.enforcement as string).length).toBeGreaterThan(0)
    expect(typeof parsed.tier).toBe('string')
  })

  it('INV-01 (alwaysActive true) text renders yes with an Enforcement line', () => {
    const result: ExplainResult = runExplain('INV-01', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Always active: yes')
    expect(result.output).toContain('Enforcement:')
  })
})

describe('explain.cov: CANON optional-field branches', () => {
  it('CANON-02 text includes both Source issues and Promoted to lines', () => {
    const result: ExplainResult = runExplain('CANON-02', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('CANON-02')
    expect(result.output).toContain('Source issues:')
    expect(result.output).toContain('Promoted to:')
  })

  it('CANON-02 JSON exposes sourceIssues and promotedTo', () => {
    const result: ExplainResult = runExplain('CANON-02', { format: 'json' })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.category).toBe('CANON')
    expect(typeof parsed.sourceIssues).toBe('string')
    expect(typeof parsed.promotedTo).toBe('string')
    expect(typeof parsed.enforcement).toBe('string')
  })

  it('CANON-01 (no promotedTo) text shows Source issues but omits Promoted to', () => {
    // CANON-01 has sourceIssues but no promotedTo — hits the
    // `if (entry.promotedTo)` FALSE branch while sourceIssues is truthy.
    const result: ExplainResult = runExplain('CANON-01', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Source issues:')
    expect(result.output).not.toContain('Promoted to:')
  })
})

describe('explain.cov: ERROR docUrl + JSON branches', () => {
  it('error text renders the docUrl See line and the Recovery block', () => {
    const result: ExplainResult = runExplain('E_CONFIG_NOT_FOUND', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Recovery:')
    expect(result.output).toContain('See: https://')
  })

  it('error JSON carries code/category/recovery/docUrl', () => {
    const result: ExplainResult = runExplain('E_CONFIG_NOT_FOUND', { format: 'json' })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.code).toBe('E_CONFIG_NOT_FOUND')
    expect(parsed.category).toBe('ERROR')
    expect(typeof parsed.recovery).toBe('string')
    expect(typeof parsed.docUrl).toBe('string')
  })
})

describe('explain.cov: FLAG branches', () => {
  it('flag resolve is case-insensitive (HASPUBLICAPI -> hasPublicApi)', () => {
    const result: ExplainResult = runExplain('HASPUBLICAPI', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hasPublicApi')
  })

  it('contractType JSON payload has the full FLAG shape', () => {
    const result: ExplainResult = runExplain('contractType', { format: 'json' })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as Record<string, unknown>
    expect(parsed.code).toBe('contractType')
    expect(parsed.category).toBe('FLAG')
    expect(typeof parsed.summary).toBe('string')
    expect(typeof parsed.detail).toBe('string')
  })

  it('isMultiTenant text renders the summary + run-list hint', () => {
    const result: ExplainResult = runExplain('isMultiTenant', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('isMultiTenant')
    expect(result.output).toContain('arbiter explain --list')
  })
})

describe('explain.cov: listAll JSON item shapes', () => {
  it('JSON list contains a representative item from every category', () => {
    const result: ExplainResult = runExplain('', { list: true, format: 'json' })
    expect(result.exitCode).toBe(0)
    const items = JSON.parse(result.output) as Array<Record<string, unknown>>
    expect(Array.isArray(items)).toBe(true)
    const categories = new Set(items.map((i: Record<string, unknown>) => i.category))
    expect(categories.has('ERROR')).toBe(true)
    expect(categories.has('INV')).toBe(true)
    expect(categories.has('CANON')).toBe(true)
    expect(categories.has('FLAG')).toBe(true)
    const flag = items.find((i: Record<string, unknown>) => i.code === 'hasPublicApi')
    expect(flag?.category).toBe('FLAG')
    expect(typeof flag?.summary).toBe('string')
  })

  it('text list groups every category and lists flag codes', () => {
    const result: ExplainResult = runExplain('', { list: true })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('FLAG codes (wizard answers):')
    expect(result.output).toContain('contractType')
    expect(result.output).toContain('isMultiTenant')
  })
})
