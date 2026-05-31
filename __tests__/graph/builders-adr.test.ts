import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { parseAdrFile, buildAdrNodes } from '../../src/graph/builders/adr.js'
import { GraphStore } from '../../src/graph/store.js'

const ADR_FILE = (num: string, title: string, status = 'active', invRefs = 'INV-58, INV-59') => `\
---
title: '${title}'
doc_version: '1.0.0'
status: ${status}
last_review: '2026-01-01'
owner: ''
canonical_id: '${num}'
tags: []
related: []
---

# ${title}

**Status:** Accepted
**Reference:** Issue #470; ${invRefs}

Body content.
`

function makeAdrDir(): { dir: string; adrDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adr-builder-'))
  const adrDir = join(dir, 'docs', 'ADR')
  mkdirSync(adrDir, { recursive: true })
  return { dir, adrDir }
}

describe('parseAdrFile', () => {
  it('returns null when canonical_id is empty', () => {
    const text = ADR_FILE('001', 'ADR-001: Test')
    const withEmpty = text.replace("canonical_id: '001'", "canonical_id: ''")
    expect(parseAdrFile(withEmpty)).toBeNull()
  })

  it('returns null when canonical_id is non-numeric', () => {
    const withBad = ADR_FILE('abc', 'ADR-abc: Bad')
    expect(parseAdrFile(withBad)).toBeNull()
  })

  it('extracts id, title, status, invRefs', () => {
    const text = ADR_FILE('042', 'ADR-042: Gate Tiers')
    const entry = parseAdrFile(text)
    expect(entry).not.toBeNull()
    expect(entry?.id).toBe('ADR:042')
    expect(entry?.title).toBe('ADR-042: Gate Tiers')
    expect(entry?.status).toBe('active')
    expect(entry?.invRefs).toContain('INV-58')
    expect(entry?.invRefs).toContain('INV-59')
  })

  it('returns empty invRefs when no Reference lines', () => {
    const noRef = `---\ntitle: 'ADR-001: Test'\nstatus: active\ncanonical_id: '001'\ntags: []\nrelated: []\n---\n\n# ADR-001\n\nNo reference lines.\n`
    const entry = parseAdrFile(noRef)
    expect(entry?.invRefs).toEqual([])
  })
})

describe('buildAdrNodes', () => {
  const cleanup: string[] = []
  afterEach(() => {
    while (cleanup.length > 0) {
      const d = cleanup.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits ADR nodes and INV stubs from per-file ADR directory', () => {
    const { dir, adrDir } = makeAdrDir()
    cleanup.push(dir)
    writeFileSync(join(adrDir, '042-gate-tiers.md'), ADR_FILE('042', 'ADR-042: Gate Tiers'))
    writeFileSync(
      join(adrDir, '043-docs-site-ia.md'),
      ADR_FILE('043', 'ADR-043: Docs IA', 'active', 'INV-10'),
    )

    const store = buildAdrNodes(new GraphStore(), { adrDir }, dir)
    const adrs = store.nodesByKind('ADR')
    expect(adrs.length).toBe(2)
    expect(adrs.map((n) => n.id)).toContain('ADR:042')
    expect(adrs.map((n) => n.id)).toContain('ADR:043')
    expect(store.nodesByKind('INV').map((n) => n.id)).toContain('INV-58')
  })

  it('emits decides edges from ADR to INV', () => {
    const { dir, adrDir } = makeAdrDir()
    cleanup.push(dir)
    writeFileSync(join(adrDir, '042-gate-tiers.md'), ADR_FILE('042', 'ADR-042: Gate Tiers'))

    const store = buildAdrNodes(new GraphStore(), { adrDir }, dir)
    const edges = store.outgoing('ADR:042', 'decides')
    expect(edges.length).toBeGreaterThan(0)
  })

  it('degrades gracefully when adrDir is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-missing-'))
    cleanup.push(dir)
    const store = buildAdrNodes(new GraphStore(), { adrDir: join(dir, 'docs', 'ADR') }, dir)
    expect(store.nodesByKind('ADR')).toHaveLength(0)
  })

  it('skips files with empty canonical_id', () => {
    const { dir, adrDir } = makeAdrDir()
    cleanup.push(dir)
    const noId = ADR_FILE('042', 'ADR-042: Gate Tiers').replace(
      "canonical_id: '042'",
      "canonical_id: ''",
    )
    writeFileSync(join(adrDir, '042-gate-tiers.md'), noId)

    const store = buildAdrNodes(new GraphStore(), { adrDir }, dir)
    expect(store.nodesByKind('ADR')).toHaveLength(0)
  })

  it('skips non-numbered files (README.md, ADR-000_template.md)', () => {
    const { dir, adrDir } = makeAdrDir()
    cleanup.push(dir)
    writeFileSync(join(adrDir, 'README.md'), '# index\n')
    writeFileSync(join(adrDir, 'ADR-000_template.md'), '# template\n')
    writeFileSync(join(adrDir, '042-gate-tiers.md'), ADR_FILE('042', 'ADR-042: Gate Tiers'))

    const store = buildAdrNodes(new GraphStore(), { adrDir }, dir)
    expect(store.nodesByKind('ADR')).toHaveLength(1)
  })

  it('re-uses pre-built INV nodes from inv builder', () => {
    const { dir, adrDir } = makeAdrDir()
    cleanup.push(dir)
    writeFileSync(join(adrDir, '042-gate-tiers.md'), ADR_FILE('042', 'ADR-042: Gate Tiers'))

    const store = new GraphStore()
    store.addNode({ id: 'INV-58', kind: 'INV', attrs: { title: 'pre-seeded' } })
    buildAdrNodes(store, { adrDir }, dir)
    expect(store.getNode('INV-58')?.attrs['title']).toBe('pre-seeded')
  })
})
