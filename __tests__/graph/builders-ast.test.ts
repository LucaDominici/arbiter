import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { extractAnnotations, buildAstNodes } from '../../src/graph/builders/ast.js'
import { GraphStore } from '../../src/graph/store.js'

const SAMPLE_TS = `
/**
 * Check that no explicit any types are used.
 * @enforces INV-04
 */
export function checkNoAny(files: string[]): boolean {
  return files.length > 0
}

/**
 * @invariant INV-12
 * @invariant INV-04
 */
export class CommandRunner {
  run(): void {}
}

// Regular function — no annotation
export function helper(): void {}
`

describe('extractAnnotations (#259-followup)', () => {
  it('extracts @enforces annotations with symbol name', () => {
    const annotations = extractAnnotations(SAMPLE_TS)
    const enforces = annotations.find(
      (a) => a.invIds.includes('INV-04') && a.symbolName === 'checkNoAny',
    )
    expect(enforces).toBeDefined()
    expect(enforces?.invIds).toContain('INV-04')
  })

  it('extracts @invariant annotations', () => {
    const annotations = extractAnnotations(SAMPLE_TS)
    const invariantAnns = annotations.filter((a) => a.symbolName === 'CommandRunner')
    expect(invariantAnns).toHaveLength(1)
    expect(invariantAnns[0]?.invIds).toContain('INV-12')
    expect(invariantAnns[0]?.invIds).toContain('INV-04')
  })

  it('ignores functions without annotations', () => {
    const annotations = extractAnnotations(SAMPLE_TS)
    const helper = annotations.find((a) => a.symbolName === 'helper')
    expect(helper).toBeUndefined()
  })

  it('returns empty array for text with no annotations', () => {
    const annotations = extractAnnotations('// no JSDoc here\nfunction foo() {}')
    expect(annotations).toEqual([])
  })
})

describe('buildAstNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits SYMBOL and FILE nodes for annotated functions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-builder-'))
    created.push(dir)
    const srcDir = join(dir, 'src')
    mkdirSync(srcDir)
    writeFileSync(join(srcDir, 'checker.ts'), SAMPLE_TS, 'utf-8')

    const store = buildAstNodes(new GraphStore(), { skipDirs: ['node_modules'] }, dir)
    const symbols = store.nodesByKind('SYMBOL')
    const symbolIds = symbols.map((s) => s.id)
    expect(symbolIds.some((id) => id.includes('checkNoAny'))).toBe(true)
    expect(symbolIds.some((id) => id.includes('CommandRunner'))).toBe(true)

    const files = store.nodesByKind('FILE')
    expect(files.length).toBeGreaterThan(0)
  })

  it('emits implements edges from SYMBOL to INV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-edges-'))
    created.push(dir)
    const srcDir = join(dir, 'src')
    mkdirSync(srcDir)
    writeFileSync(join(srcDir, 'checker.ts'), SAMPLE_TS, 'utf-8')

    const store = buildAstNodes(new GraphStore(), { skipDirs: ['node_modules'] }, dir)
    const symbols = store.nodesByKind('SYMBOL')
    const checkNoAny = symbols.find((s) => s.id.includes('checkNoAny'))
    if (checkNoAny === undefined) throw new Error('symbol not found')
    const edges = store.outgoing(checkNoAny.id, 'implements')
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.map((e) => e.to)).toContain('INV-04')
  })

  it('skips files without @enforces or @invariant', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ast-skip-'))
    created.push(dir)
    const srcDir = join(dir, 'src')
    mkdirSync(srcDir)
    writeFileSync(
      join(srcDir, 'plain.ts'),
      '// no annotations\nexport function plain() {}',
      'utf-8',
    )

    const store = buildAstNodes(new GraphStore(), { skipDirs: ['node_modules'] }, dir)
    expect(store.nodesByKind('SYMBOL')).toHaveLength(0)
  })

  it('degrades gracefully when projectRoot does not exist', () => {
    const store = buildAstNodes(new GraphStore(), {}, '/nonexistent/path')
    expect(store.allNodes()).toHaveLength(0)
  })
})
