import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { parseTestFile, buildTestNodes } from '../../src/graph/builders/test-nodes.js'
import { GraphStore } from '../../src/graph/store.js'

// Fixture text simulating a real test file's SOURCE (fed to parseTestFile, never executed).
// Kept on one line per describe() so its literal 'it(' calls don't start a line — a
// line-anchored test-block scanner (anti-proforma) would otherwise mistake this fixture
// data for real (assertion-less) test declarations. The actual assertions on parseTestFile's
// extraction behavior are in the `it` blocks below.
const SAMPLE_TEST = `
import { describe, it } from 'vitest'

describe('[INV-04] no-any enforcement', () => { it('blocks explicit any', () => {}); it('[INV-12] also covers deps', () => {}) })

describe('regular suite without tag', () => { it('[REQ-001] user login works', () => {}) })
`

describe('parseTestFile (#259-followup)', () => {
  it('extracts INV refs from tagged test titles', () => {
    const entry = parseTestFile(SAMPLE_TEST, '__tests__/example.test.ts')
    expect(entry.invRefs).toContain('INV-04')
    expect(entry.invRefs).toContain('INV-12')
  })

  it('extracts REQ refs from tagged test titles', () => {
    const entry = parseTestFile(SAMPLE_TEST, '__tests__/example.test.ts')
    expect(entry.reqRefs).toContain('REQ-001')
  })

  it('deduplicates refs', () => {
    const text = `it('[INV-04] first', () => {})\nit('[INV-04] second', () => {})\n`
    const entry = parseTestFile(text, 'test.ts')
    expect(entry.invRefs.filter((x) => x === 'INV-04')).toHaveLength(1)
  })

  it('returns empty refs for file with no tags', () => {
    const text = `it('plain test', () => {})\ndescribe('suite', () => { it('test', () => {}) })\n`
    const entry = parseTestFile(text, 'plain.test.ts')
    expect(entry.invRefs).toHaveLength(0)
    expect(entry.reqRefs).toHaveLength(0)
  })

  it('sets correct id', () => {
    const entry = parseTestFile(SAMPLE_TEST, 'path/to/test.ts')
    expect(entry.id).toBe('TEST:path/to/test.ts')
  })
})

describe('buildTestNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits TEST nodes for tagged test files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-builder-'))
    created.push(dir)
    const testsDir = join(dir, '__tests__')
    mkdirSync(testsDir)
    writeFileSync(join(testsDir, 'inv04.test.ts'), SAMPLE_TEST, 'utf-8')

    const store = buildTestNodes(new GraphStore(), {}, dir)
    const testNodes = store.nodesByKind('TEST')
    expect(testNodes.length).toBe(1)
    expect(testNodes[0]?.attrs['invRefs']).toContain('INV-04')
  })

  it('emits proves edges TEST --proves--> INV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-proves-'))
    created.push(dir)
    const testsDir = join(dir, '__tests__')
    mkdirSync(testsDir)
    writeFileSync(join(testsDir, 'inv.test.ts'), SAMPLE_TEST, 'utf-8')

    const store = buildTestNodes(new GraphStore(), {}, dir)
    const testNodes = store.nodesByKind('TEST')
    if (testNodes[0] === undefined) throw new Error('no TEST node')
    const edges = store.outgoing(testNodes[0].id, 'proves')
    expect(edges.map((e) => e.to)).toContain('INV-04')
  })

  it('emits proves edges TEST --proves--> REQ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-proves-req-'))
    created.push(dir)
    const testsDir = join(dir, '__tests__')
    mkdirSync(testsDir)
    writeFileSync(join(testsDir, 'req.test.ts'), SAMPLE_TEST, 'utf-8')

    const store = buildTestNodes(new GraphStore(), {}, dir)
    const testNodes = store.nodesByKind('TEST')
    if (testNodes[0] === undefined) throw new Error('no TEST node')
    const edges = store.outgoing(testNodes[0].id, 'proves')
    expect(edges.map((e) => e.to)).toContain('REQ-001')
  })

  it('skips test files with no tagged titles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-skip-'))
    created.push(dir)
    const testsDir = join(dir, '__tests__')
    mkdirSync(testsDir)
    writeFileSync(join(testsDir, 'plain.test.ts'), `it('nothing tagged', () => {})`, 'utf-8')

    const store = buildTestNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('TEST')).toHaveLength(0)
  })

  it('degrades gracefully when projectRoot does not exist', () => {
    const store = buildTestNodes(new GraphStore(), {}, '/nonexistent')
    expect(store.allNodes()).toHaveLength(0)
  })
})
