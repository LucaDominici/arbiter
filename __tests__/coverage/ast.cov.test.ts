// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/graph/builders/ast.ts (#1486).
 *
 * Exercises the uncovered branches of extractAnnotations / findNextSymbolName /
 * buildAstNodes: single-line JSDoc, empty-JSDoc, annotation-without-symbol,
 * bare (non-export) declarations, the break/exhaust paths of the symbol scan,
 * java/rust extension switches, the default-skip-dirs path, and the
 * already-present-INV-node branch.
 *
 * Pure functions + a real mkdtempSync temp fixture (cleaned in afterEach).
 * No network, no git/gh, no spawn, no process.exit.
 */
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { extractAnnotations, buildAstNodes } from '../../src/graph/builders/ast.js'
import type { AstAnnotation } from '../../src/graph/builders/ast.js'
import { GraphStore } from '../../src/graph/store.js'
import type { GraphNode } from '../../src/graph/model.js'

describe('ast.cov: extractAnnotations branch coverage', () => {
  it('captures the @enforces id when the tag is on the JSDoc opener line', () => {
    // The opener line `/** @enforces INV-07` matches both JSDOC_OPEN_RE and
    // ANNOTATION_RE, exercising the same-line-as-open annotation branch. The
    // block is closed on a later line (single-line `/** ... */` is a documented
    // module limitation and is intentionally not asserted here).
    const text = ['/** @enforces INV-07', ' */', 'export function singleLine(): void {}'].join('\n')
    const anns: AstAnnotation[] = extractAnnotations(text)
    const hit = anns.find((a) => a.symbolName === 'singleLine')
    expect(hit).toBeDefined()
    expect(hit?.invIds).toContain('INV-07')
  })

  it('attaches an annotation to an `export let` declaration variant', () => {
    // Exercises the SYMBOL_DECL_RE `let` alternative.
    const text = ['/**', ' * @invariant INV-66', ' */', 'export let mutableThing = 0'].join('\n')
    const anns = extractAnnotations(text)
    expect(anns.find((a) => a.symbolName === 'mutableThing')).toBeDefined()
  })

  it('drops a JSDoc block that closes with no INV ids (pendingInvIds empty)', () => {
    // Opens a JSDoc, has an annotation tag but NO INV-NN id, then closes.
    // pendingInvIds stays empty so the close branch takes its length===0 path.
    const text = ['/**', ' * @enforces (no id here)', ' */', 'export function noId(): void {}'].join(
      '\n',
    )
    const anns = extractAnnotations(text)
    expect(anns.find((a) => a.symbolName === 'noId')).toBeUndefined()
    expect(anns).toEqual([])
  })

  it('produces no annotation when ids are present but no symbol follows', () => {
    // JSDoc with a real INV id but the following lines hold no declaration:
    // findNextSymbolName returns null, so the symbolName!==null branch is false.
    const text = ['/**', ' * @invariant INV-99', ' */', '', 'const x = 1; // not a decl line'].join(
      '\n',
    )
    const anns = extractAnnotations(text)
    // INV id was collected but no symbol could be attached -> nothing emitted.
    expect(anns).toEqual([])
  })

  it('attaches an annotation to a BARE (non-export) function declaration', () => {
    const text = ['/**', ' * @enforces INV-21', ' */', 'async function bareFn(): Promise<void> {}'].join(
      '\n',
    )
    const anns = extractAnnotations(text)
    const hit = anns.find((a) => a.symbolName === 'bareFn')
    expect(hit).toBeDefined()
    expect(hit?.invIds).toContain('INV-21')
  })

  it('attaches an annotation to a bare class declaration', () => {
    const text = ['/**', ' * @invariant INV-33', ' */', 'class BareClass {}'].join('\n')
    const anns = extractAnnotations(text)
    expect(anns.find((a) => a.symbolName === 'BareClass')).toBeDefined()
  })

  it('attaches to an export default declaration variant', () => {
    const text = ['/**', ' * @enforces INV-08', ' */', 'export default class Defaulted {}'].join('\n')
    const anns = extractAnnotations(text)
    expect(anns.find((a) => a.symbolName === 'Defaulted')).toBeDefined()
  })

  it('breaks at the first non-blank, non-declaration line (no symbol found)', () => {
    // First non-blank line after the close is a comment, not a declaration:
    // the loop hits `break` and returns null.
    const text = [
      '/**',
      ' * @enforces INV-44',
      ' */',
      '// a comment, not a declaration',
      'export function tooLate(): void {}',
    ].join('\n')
    const anns = extractAnnotations(text)
    expect(anns).toEqual([])
  })

  it('returns null when the next 5 lines are all blank (loop exhausted)', () => {
    // Five blank lines keep `continue`-ing until the window closes -> null.
    const text = ['/**', ' * @invariant INV-55', ' */', '', '', '', '', '', 'export const late = 1'].join(
      '\n',
    )
    const anns = extractAnnotations(text)
    expect(anns).toEqual([])
  })

  it('handles a JSDoc that opens and closes with the annotation on its own line', () => {
    const text = ['/**', ' * @enforces INV-04 INV-12', ' */', 'export const declHere = () => 0'].join(
      '\n',
    )
    const anns = extractAnnotations(text)
    const hit = anns.find((a) => a.symbolName === 'declHere')
    expect(hit?.invIds).toContain('INV-04')
    expect(hit?.invIds).toContain('INV-12')
  })
})

describe('ast.cov: buildAstNodes branch coverage', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  function freshDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    created.push(dir)
    return dir
  }

  it('uses the default skip-dir set when opts.skipDirs is omitted', () => {
    // skipDirs omitted -> DEFAULT_SKIP_DIRS branch. A node_modules dir under
    // the root must be skipped even though it contains an annotated .ts file.
    const dir = freshDir('ast-defaultskip-')
    const src = join(dir, 'src')
    const nm = join(dir, 'node_modules')
    mkdirSync(src)
    mkdirSync(nm)
    const annotated = ['/**', ' * @enforces INV-04', ' */', 'export function inSrc(): void {}'].join(
      '\n',
    )
    writeFileSync(join(src, 'real.ts'), annotated, 'utf-8')
    writeFileSync(
      join(nm, 'dep.ts'),
      ['/**', ' * @enforces INV-99', ' */', 'export function inDep(): void {}'].join('\n'),
      'utf-8',
    )

    const store = buildAstNodes(new GraphStore(), {}, dir)
    const symbolIds = store.nodesByKind('SYMBOL').map((s) => s.id)
    expect(symbolIds.some((id) => id.includes('inSrc'))).toBe(true)
    // node_modules was skipped by the default set:
    expect(symbolIds.some((id) => id.includes('inDep'))).toBe(false)
  })

  it('scans .java files when extensions includes java and skips .ts', () => {
    const dir = freshDir('ast-java-')
    const src = join(dir, 'src')
    mkdirSync(src)
    // A bare `class JavaThing {}` declaration line is recognised by BARE_DECL_RE,
    // so the scanned .java file yields a symbol -> proves the java ext branch ran.
    const javaText = ['/**', ' * @enforces INV-13', ' */', 'class JavaThing {}'].join('\n')
    writeFileSync(join(src, 'Thing.java'), javaText, 'utf-8')
    // A .ts file that must NOT be scanned when only java is requested.
    writeFileSync(
      join(src, 'ignored.ts'),
      ['/**', ' * @enforces INV-77', ' */', 'export function tsIgnored(): void {}'].join('\n'),
      'utf-8',
    )

    const store = buildAstNodes(new GraphStore(), { extensions: ['java'] }, dir)
    const symbolIds = store.nodesByKind('SYMBOL').map((s) => s.id)
    // The .java file was scanned and produced a symbol.
    expect(symbolIds.some((id) => id.includes('JavaThing'))).toBe(true)
    // The .ts file was filtered out by the extension predicate.
    expect(symbolIds.some((id) => id.includes('tsIgnored'))).toBe(false)
  })

  it('scans .rs files when extensions includes rust and skips other exts', () => {
    const dir = freshDir('ast-rust-')
    const src = join(dir, 'src')
    mkdirSync(src)
    // `class RustyThing {}` is matched by BARE_DECL_RE; this confirms the rust
    // extension branch in the walk predicate fired and the file was scanned.
    const rustText = ['/**', ' * @enforces INV-19', ' */', 'class RustyThing {}'].join('\n')
    writeFileSync(join(src, 'lib.rs'), rustText, 'utf-8')
    writeFileSync(
      join(src, 'main.ts'),
      ['/**', ' * @enforces INV-88', ' */', 'export function tsToo(): void {}'].join('\n'),
      'utf-8',
    )

    const store = buildAstNodes(new GraphStore(), { extensions: ['rust'] }, dir)
    const symbolIds = store.nodesByKind('SYMBOL').map((s) => s.id)
    expect(symbolIds.some((id) => id.includes('RustyThing'))).toBe(true)
    expect(symbolIds.some((id) => id.includes('tsToo'))).toBe(false)
  })

  it('reuses an INV node already present in the store (no duplicate upsert path)', () => {
    // Pre-seed the store with INV-04 so the `!store.hasNode(invId)` branch is
    // false when the builder reaches it.
    const store = new GraphStore()
    const preExisting: GraphNode = {
      id: 'INV-04',
      kind: 'INV',
      attrs: { source: 'pre-seeded' },
    }
    store.addNode(preExisting)

    const dir = freshDir('ast-existinginv-')
    const src = join(dir, 'src')
    mkdirSync(src)
    writeFileSync(
      join(src, 'checker.ts'),
      ['/**', ' * @enforces INV-04', ' */', 'export function checks(): void {}'].join('\n'),
      'utf-8',
    )

    const out = buildAstNodes(store, { skipDirs: ['node_modules'] }, dir)
    // The pre-seeded INV node is preserved (its source attr is untouched).
    const inv = out.getNode('INV-04')
    expect(inv).toBeDefined()
    expect(inv?.attrs.source).toBe('pre-seeded')
    // And the implements edge was still wired from the new symbol.
    const symbol = out.nodesByKind('SYMBOL').find((s) => s.id.includes('checks'))
    if (symbol === undefined) throw new Error('symbol not found')
    const edges = out.outgoing(symbol.id, 'implements')
    expect(edges.map((e: { to: string }) => e.to)).toContain('INV-04')
  })

  it('respects a custom source label in emitted node attrs', () => {
    const dir = freshDir('ast-source-')
    const src = join(dir, 'src')
    mkdirSync(src)
    writeFileSync(
      join(src, 'c.ts'),
      ['/**', ' * @enforces INV-04', ' */', 'export function labelled(): void {}'].join('\n'),
      'utf-8',
    )

    const store = buildAstNodes(new GraphStore(), { source: 'custom-src', skipDirs: [] }, dir)
    const symbol = store.nodesByKind('SYMBOL').find((s) => s.id.includes('labelled'))
    expect(symbol?.attrs.source).toBe('custom-src')
  })

  it('produces an empty store when the tree has files but none are annotated', () => {
    const dir = freshDir('ast-noann-')
    const src = join(dir, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'plain.ts'), 'export function plain(): void {}', 'utf-8')

    const store = buildAstNodes(new GraphStore(), { skipDirs: ['node_modules'] }, dir)
    expect(store.nodesByKind('SYMBOL')).toHaveLength(0)
    expect(store.nodesByKind('FILE')).toHaveLength(0)
  })
})
