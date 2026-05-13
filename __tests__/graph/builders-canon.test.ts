import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { parseCanon, buildCanonNodes } from '../../src/graph/builders/canon.js'
import { GraphStore } from '../../src/graph/store.js'

const SAMPLE_CANON = `
# Canon

> Violation protocol: STOP.

---

## CANON-01 -- Dual-sided declination

**Rule:** Every governance mechanism that arbiter applies to itself must also exist as a generator template.

**Enforcement:** Prose check at PR review.

---

## CANON-02 -- Proven cell => gated step

**Rule:** Every tool cell marked proven must produce a concrete invocation step.

**Enforcement:** Prose check.

**Promoted to:** INV-47

---

## CANON-16 -- Refactor-first before creating new source files

**Rule:** Survey before creating new files.

**Enforcement:** Code review.

**Promoted to:** INV-46

---
`

describe('parseCanon (#259-followup)', () => {
  it('extracts CANON entries', () => {
    const entries = parseCanon(SAMPLE_CANON)
    expect(entries.map((e) => e.id)).toContain('CANON-01')
    expect(entries.map((e) => e.id)).toContain('CANON-02')
    expect(entries.map((e) => e.id)).toContain('CANON-16')
  })

  it('extracts rule titles', () => {
    const entries = parseCanon(SAMPLE_CANON)
    const canon01 = entries.find((e) => e.id === 'CANON-01')
    expect(canon01?.title).toContain('Dual-sided')
  })

  it('extracts promotedTo field', () => {
    const entries = parseCanon(SAMPLE_CANON)
    const canon02 = entries.find((e) => e.id === 'CANON-02')
    expect(canon02?.promotedTo).toBe('INV-47')
    const canon01 = entries.find((e) => e.id === 'CANON-01')
    expect(canon01?.promotedTo).toBeNull()
  })

  it('returns empty array for text with no CANON sections', () => {
    const entries = parseCanon('# Not CANON\n\nNothing here.')
    expect(entries).toEqual([])
  })
})

describe('buildCanonNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits CANON nodes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-builder-'))
    created.push(dir)
    const canonPath = join(dir, 'CANON.md')
    writeFileSync(canonPath, SAMPLE_CANON, 'utf-8')

    const store = buildCanonNodes(new GraphStore(), { canonPath }, dir)
    const canons = store.nodesByKind('CANON')
    expect(canons.map((c) => c.id)).toContain('CANON-01')
    expect(canons.map((c) => c.id)).toContain('CANON-02')
    expect(canons.map((c) => c.id)).toContain('CANON-16')
  })

  it('emits promotes edges for graduated rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-promotes-'))
    created.push(dir)
    const canonPath = join(dir, 'CANON.md')
    writeFileSync(canonPath, SAMPLE_CANON, 'utf-8')

    const store = buildCanonNodes(new GraphStore(), { canonPath }, dir)
    const edges02 = store.outgoing('CANON-02', 'promotes')
    expect(edges02.length).toBe(1)
    expect(edges02[0]?.to).toBe('INV-47')

    const edges16 = store.outgoing('CANON-16', 'promotes')
    expect(edges16.length).toBe(1)
    expect(edges16[0]?.to).toBe('INV-46')
  })

  it('does NOT emit promotes edge for non-graduated rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-no-promote-'))
    created.push(dir)
    const canonPath = join(dir, 'CANON.md')
    writeFileSync(canonPath, SAMPLE_CANON, 'utf-8')

    const store = buildCanonNodes(new GraphStore(), { canonPath }, dir)
    const edges01 = store.outgoing('CANON-01', 'promotes')
    expect(edges01).toHaveLength(0)
  })

  it('degrades gracefully when CANON.md is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-missing-'))
    created.push(dir)
    const store = buildCanonNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('CANON')).toHaveLength(0)
  })

  it('works with the actual CANON.md in arbiter', () => {
    const store = buildCanonNodes(new GraphStore(), { canonPath: 'docs/SYSTEM/CANON.md' }, '.')
    const canons = store.nodesByKind('CANON')
    expect(canons.length).toBeGreaterThan(0)
    // Promoted entries create INV stubs
    const invStubs = store.nodesByKind('INV')
    expect(invStubs.length).toBeGreaterThan(0)
  })
})
