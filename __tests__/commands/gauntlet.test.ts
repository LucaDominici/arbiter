/**
 * `arbiter gauntlet` command tests (#260).
 *
 * Covers:
 *   AC-1  generate reads YAML spec, outputs deterministic test files
 *   AC-3  per-stack emitters (TypeScript Playwright, Java JUnit5, Rust rstest)
 *   AC-4  verify checks spec exists for requires-gauntlet features
 *   AC-5  gate: generated tests in sync with spec (hash)
 *   AC-6  graph integration: emits edges when .arbiter/graph.json exists
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  runGauntletGenerate,
  runGauntletVerify,
} from '../../src/commands/gauntlet.js'

// ── minimal spec fixture ──────────────────────────────────────────────────

const BASIC_SPEC = `
name: trip-form
dimensions:
  transport: [car, train, plane]
  duration: [1d, 3d, 7d]
  travelers: [solo, couple, family]
strategy: pairwise
constraints:
  - when: { transport: plane, duration: 1d }
    then: skip
tags: ["@gauntlet", "@trip-form"]
`

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gauntlet-test-'))
}

function writeSpec(dir: string, content: string = BASIC_SPEC, name = 'gauntlet.yaml'): string {
  const p = join(dir, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('gauntlet generate (#260, AC-1 AC-3)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('generates TypeScript test files (default stack)', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.files.length).toBeGreaterThan(0)
    const content = readFileSync(result.files[0]!, 'utf-8')
    expect(content).toContain('describe')
    expect(content).toContain('@gauntlet')
  })

  it('generates Java test files', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'java' })
    expect(result.status).toBe('ok')
    expect(result.files.length).toBeGreaterThan(0)
    const content = readFileSync(result.files[0]!, 'utf-8')
    expect(content).toContain('@ParameterizedTest')
  })

  it('generates Rust test files', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'rust' })
    expect(result.status).toBe('ok')
    expect(result.files.length).toBeGreaterThan(0)
    const content = readFileSync(result.files[0]!, 'utf-8')
    expect(content).toContain('#[rstest]')
  })

  it('output is byte-stable (deterministic)', () => {
    const dirA = makeTmp(); dirs.push(dirA)
    const dirB = makeTmp(); dirs.push(dirB)
    writeSpec(dirA); writeSpec(dirB)
    const rA = runGauntletGenerate({ spec: join(dirA, 'gauntlet.yaml'), out: join(dirA, 'out'), stack: 'typescript' })
    const rB = runGauntletGenerate({ spec: join(dirB, 'gauntlet.yaml'), out: join(dirB, 'out'), stack: 'typescript' })
    expect(rA.status).toBe('ok')
    expect(rB.status).toBe('ok')
    const cA = readFileSync(rA.files[0]!, 'utf-8')
    const cB = readFileSync(rB.files[0]!, 'utf-8')
    expect(cA).toBe(cB)
  })

  it('writes spec hash alongside generated tests', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    expect(result.status).toBe('ok')
    expect(existsSync(join(outDir, '.gauntlet-hash'))).toBe(true)
  })

  it('errors on missing spec file', () => {
    const dir = makeTmp(); dirs.push(dir)
    const result = runGauntletGenerate({ spec: join(dir, 'nope.yaml'), out: join(dir, 'out'), stack: 'typescript' })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found/)
  })

  it('errors on invalid spec (missing name)', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir, 'dimensions:\n  a: [1,2]\n')
    const result = runGauntletGenerate({ spec, out: join(dir, 'out'), stack: 'typescript' })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/name/)
  })

  it('integrates with graph: emits GAUNTLET edges when graph.json exists', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    // Minimal graph.json
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'graph.json'),
      JSON.stringify({ nodes: [], edges: [] }, null, 2),
      'utf-8',
    )
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript', dir })
    expect(result.status).toBe('ok')
    expect(result.graphEdges).toBeGreaterThan(0)
  })
})

describe('gauntlet verify (#260, AC-4 AC-5)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('passes when hash is in sync', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    const result = runGauntletVerify({ spec, out: outDir, coverage: 'pairwise' })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('fails when spec has changed after generation', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    // Mutate spec
    writeFileSync(spec, BASIC_SPEC + '\n# changed\n', 'utf-8')
    const result = runGauntletVerify({ spec, out: outDir, coverage: 'pairwise' })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/out of sync/)
  })

  it('fails when out dir is missing', () => {
    const dir = makeTmp(); dirs.push(dir)
    const spec = writeSpec(dir)
    const result = runGauntletVerify({ spec, out: join(dir, 'nonexistent'), coverage: 'pairwise' })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found|no generated/)
  })
})
