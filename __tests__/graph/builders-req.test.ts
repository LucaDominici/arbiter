import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { parseReqText, buildReqNodes } from '../../src/graph/builders/req.js'
import { GraphStore } from '../../src/graph/store.js'

const TABLE_TEXT = `
# Feature Matrix

| REQ-001 | User login | implemented | ✓ |
| REQ-002 | Password reset | pending | - |
`

const HEADING_TEXT = `
## REQ-010: Multi-language support

Some description here.

## REQ-011 - Idempotent board

Another description.
`

describe('parseReqText (#259-followup)', () => {
  it('extracts REQ ids from markdown table rows', () => {
    const entries = parseReqText(TABLE_TEXT, 'FEATURE_MATRIX.md')
    expect(entries.map((e) => e.id)).toContain('REQ-001')
    expect(entries.map((e) => e.id)).toContain('REQ-002')
    expect(entries.find((e) => e.id === 'REQ-001')?.title).toBe('User login')
  })

  it('extracts REQ ids from headings', () => {
    const entries = parseReqText(HEADING_TEXT, 'REQUIREMENTS_MATRIX.md')
    expect(entries.map((e) => e.id)).toContain('REQ-010')
    expect(entries.map((e) => e.id)).toContain('REQ-011')
  })

  it('deduplicates REQ ids', () => {
    const text = `| REQ-001 | first |\n| REQ-001 | duplicate |\n`
    const entries = parseReqText(text, 'test.md')
    expect(entries.filter((e) => e.id === 'REQ-001')).toHaveLength(1)
  })

  it('returns empty array for text with no REQ ids', () => {
    const entries = parseReqText('# No requirements here\n\nJust text.', 'test.md')
    expect(entries).toEqual([])
  })
})

describe('buildReqNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits REQ nodes from FEATURE_MATRIX.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-builder-'))
    created.push(dir)
    writeFileSync(join(dir, 'FEATURE_MATRIX.md'), TABLE_TEXT, 'utf-8')

    const store = buildReqNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('REQ').map((n) => n.id)).toContain('REQ-001')
    expect(store.nodesByKind('REQ').map((n) => n.id)).toContain('REQ-002')
  })

  it('emits REQ nodes from REQUIREMENTS_MATRIX.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-reqs-'))
    created.push(dir)
    writeFileSync(join(dir, 'REQUIREMENTS_MATRIX.md'), HEADING_TEXT, 'utf-8')

    const store = buildReqNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('REQ').map((n) => n.id)).toContain('REQ-010')
  })

  it('degrades gracefully when no matrix files exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-missing-'))
    created.push(dir)
    const store = buildReqNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('REQ')).toHaveLength(0)
  })

  it('uses file override for tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-override-'))
    created.push(dir)
    const customFile = join(dir, 'custom-reqs.md')
    writeFileSync(customFile, TABLE_TEXT, 'utf-8')
    const store = buildReqNodes(new GraphStore(), { files: [customFile] }, dir)
    expect(store.nodesByKind('REQ').length).toBeGreaterThan(0)
  })
})
