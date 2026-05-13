import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { parseDecisions, buildAdrNodes } from '../../src/graph/builders/adr.js'
import { GraphStore } from '../../src/graph/store.js'

const SAMPLE_DECISIONS = `
# Architectural Decision Records

---

## feat(#470): soloDevMode (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-58, INV-59

**Context:** Solo-dev workflow.

**Decisions:** Allow direct merge after L2 green.

**Consequences:** Faster merges.

---

## feat(#253): verification bridge (2026-05-01)

**Status:** Accepted
**Reference:** Issue #253; INV-55

**Context:** Verification bridge.

---
`

describe('parseDecisions (#259-followup)', () => {
  it('extracts ADR entries from DECISIONS.md', () => {
    const entries = parseDecisions(SAMPLE_DECISIONS)
    expect(entries.length).toBe(2)
    expect(entries[0]?.id).toMatch(/^ADR:/)
    expect(entries[0]?.status).toBe('Accepted')
  })

  it('extracts INV refs from Reference lines', () => {
    const entries = parseDecisions(SAMPLE_DECISIONS)
    const first = entries[0]
    expect(first?.invRefs).toContain('INV-58')
    expect(first?.invRefs).toContain('INV-59')
    const second = entries[1]
    expect(second?.invRefs).toContain('INV-55')
  })

  it('returns empty array for text with no ADR sections', () => {
    const entries = parseDecisions('# Just a title\n\nNo decisions here.')
    expect(entries).toEqual([])
  })

  it('ignores sections without Status or Reference', () => {
    const text = `## Not a Decision\n\nSome content.\n\n---\n\n## feat(#1): real decision (2026-01-01)\n\n**Status:** Accepted\n**Reference:** INV-01\n`
    const entries = parseDecisions(text)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.invRefs).toContain('INV-01')
  })
})

describe('buildAdrNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits ADR nodes and decides edges', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-builder-'))
    created.push(dir)
    const decisionsDir = join(dir, 'docs', 'SYSTEM')
    mkdirSync(decisionsDir, { recursive: true })
    writeFileSync(join(decisionsDir, 'DECISIONS.md'), SAMPLE_DECISIONS, 'utf-8')

    const store = buildAdrNodes(new GraphStore(), {}, dir)
    const adrs = store.nodesByKind('ADR')
    expect(adrs.length).toBe(2)

    const invNodes = store.nodesByKind('INV')
    expect(invNodes.map((n) => n.id)).toContain('INV-58')
    expect(invNodes.map((n) => n.id)).toContain('INV-59')
  })

  it('emits decides edges from ADR to INV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-edges-'))
    created.push(dir)
    const decisionsDir = join(dir, 'docs', 'SYSTEM')
    mkdirSync(decisionsDir, { recursive: true })
    writeFileSync(join(decisionsDir, 'DECISIONS.md'), SAMPLE_DECISIONS, 'utf-8')

    const store = buildAdrNodes(new GraphStore(), {}, dir)
    const adrs = store.nodesByKind('ADR')
    const firstAdr = adrs[0]
    if (firstAdr === undefined) throw new Error('no ADR nodes')
    const edges = store.outgoing(firstAdr.id, 'decides')
    expect(edges.length).toBeGreaterThan(0)
  })

  it('degrades gracefully when DECISIONS.md is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-missing-'))
    created.push(dir)
    const store = buildAdrNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('ADR')).toHaveLength(0)
  })

  it('uses decisionsPath override for tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-override-'))
    created.push(dir)
    const overridePath = join(dir, 'my-decisions.md')
    writeFileSync(overridePath, SAMPLE_DECISIONS, 'utf-8')
    const store = buildAdrNodes(new GraphStore(), { decisionsPath: overridePath }, dir)
    expect(store.nodesByKind('ADR').length).toBe(2)
  })

  it('re-uses pre-built INV nodes from inv builder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-reuse-'))
    created.push(dir)
    const overridePath = join(dir, 'decisions.md')
    writeFileSync(overridePath, SAMPLE_DECISIONS, 'utf-8')
    // Pre-seed INV-58
    const store = new GraphStore()
    store.addNode({ id: 'INV-58', kind: 'INV', attrs: { title: 'pre-seeded' } })
    buildAdrNodes(store, { decisionsPath: overridePath }, dir)
    // Should not throw (upsertNode is idempotent)
    const inv58 = store.getNode('INV-58')
    expect(inv58?.attrs['title']).toBe('pre-seeded')
  })
})
