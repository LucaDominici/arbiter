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
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runGauntletGenerate, runGauntletVerify } from '../../src/commands/gauntlet.js'

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
    const dir = makeTmp()
    dirs.push(dir)
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
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'java' })
    expect(result.status).toBe('ok')
    expect(result.files.length).toBeGreaterThan(0)
    const content = readFileSync(result.files[0]!, 'utf-8')
    expect(content).toContain('@ParameterizedTest')
  })

  it('generates Rust test files', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'rust' })
    expect(result.status).toBe('ok')
    expect(result.files.length).toBeGreaterThan(0)
    const content = readFileSync(result.files[0]!, 'utf-8')
    expect(content).toContain('#[rstest]')
  })

  it('output is byte-stable (deterministic)', () => {
    const dirA = makeTmp()
    dirs.push(dirA)
    const dirB = makeTmp()
    dirs.push(dirB)
    writeSpec(dirA)
    writeSpec(dirB)
    const rA = runGauntletGenerate({
      spec: join(dirA, 'gauntlet.yaml'),
      out: join(dirA, 'out'),
      stack: 'typescript',
    })
    const rB = runGauntletGenerate({
      spec: join(dirB, 'gauntlet.yaml'),
      out: join(dirB, 'out'),
      stack: 'typescript',
    })
    expect(rA.status).toBe('ok')
    expect(rB.status).toBe('ok')
    const cA = readFileSync(rA.files[0]!, 'utf-8')
    const cB = readFileSync(rB.files[0]!, 'utf-8')
    expect(cA).toBe(cB)
  })

  it('writes spec hash alongside generated tests', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    expect(result.status).toBe('ok')
    expect(existsSync(join(outDir, '.gauntlet-hash'))).toBe(true)
  })

  it('errors on missing spec file', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const result = runGauntletGenerate({
      spec: join(dir, 'nope.yaml'),
      out: join(dir, 'out'),
      stack: 'typescript',
    })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found/)
  })

  it('errors on invalid spec (missing name)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir, 'dimensions:\n  a: [1,2]\n')
    const result = runGauntletGenerate({ spec, out: join(dir, 'out'), stack: 'typescript' })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/name/)
  })

  it('confines the output file to outDir when spec.name contains "/" or ".." (#1620)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const malicious = `name: "../ESCAPED"\ndimensions:\n  a: [x, y]\n  b: [p, q]\n`
    const spec = writeSpec(dir, malicious)
    const outDir = join(dir, 'out')
    const result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    expect(result.status).toBe('ok')
    const written = result.files[0]!
    // The artifact must NOT escape outDir.
    expect(resolve(written).startsWith(resolve(outDir) + sep)).toBe(true)
    expect(existsSync(written)).toBe(true)
    // Nothing escaped to the parent dir.
    expect(existsSync(join(dir, 'ESCAPED-gauntlet.spec.ts'))).toBe(false)
    // Manifest and disk agree, so verify still passes.
    expect(runGauntletVerify({ spec, out: outDir }).status).toBe('ok')
  })

  it('returns a structured exit-2 error (not a thrown crash) when outDir cannot be created (#1648)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    // A regular file in the path makes `mkdir -p` throw ENOTDIR (recursive does
    // NOT swallow a file as a path component).
    const blocker = join(dir, 'afile')
    writeFileSync(blocker, 'x', 'utf-8')
    let result: ReturnType<typeof runGauntletGenerate> | undefined
    expect(() => {
      result = runGauntletGenerate({ spec, out: join(blocker, 'sub'), stack: 'typescript' })
    }).not.toThrow()
    expect(result?.status).toBe('error')
    expect(result?.exitCode).toBe(2)
    expect(result?.reason).toBeTruthy()
  })

  it('integrates with graph: emits GAUNTLET edges when graph.json exists', () => {
    const dir = makeTmp()
    dirs.push(dir)
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

  it('degrades to zero edges on a malformed graph.json instead of crashing (#1593)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    // Valid JSON, but missing the nodes/edges arrays — must not throw.
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'graph.json'), '{}', 'utf-8')
    let result: ReturnType<typeof runGauntletGenerate> | undefined
    expect(() => {
      result = runGauntletGenerate({ spec, out: outDir, stack: 'typescript', dir })
    }).not.toThrow()
    expect(result?.status).toBe('ok')
    expect(result?.graphEdges).toBe(0)
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
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('fails when spec has changed after generation', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    // Mutate spec
    writeFileSync(spec, BASIC_SPEC + '\n# changed\n', 'utf-8')
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/out of sync/)
  })

  it('fails when out dir is missing', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const result = runGauntletVerify({ spec, out: join(dir, 'nonexistent') })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found|no generated/)
  })

  it('fails (exit 2) when the generated test file was deleted (#1572)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const gen = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    // Tamper: delete the generated artifact, keep the spec and hash sidecar.
    rmSync(gen.files[0]!, { force: true })
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toMatch(/missing|deleted/i)
  })

  it('fails (exit 2) when the generated test file was hand-edited (#1572)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const gen = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    // Tamper: gut the generated artifact while leaving the spec untouched.
    writeFileSync(gen.files[0]!, '// gutted, no assertions\n', 'utf-8')
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toMatch(/modified|drift|sync/i)
  })

  it('tracks every stack artifact in a shared outDir; editing any one fails verify (#1644)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    const ts = runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    const jv = runGauntletGenerate({ spec, out: outDir, stack: 'java' })
    expect(ts.status).toBe('ok')
    expect(jv.status).toBe('ok')
    // Both artifacts coexist on disk.
    expect(existsSync(ts.files[0]!)).toBe(true)
    expect(existsSync(jv.files[0]!)).toBe(true)
    // The TypeScript artifact (NOT the most-recently-generated one) is tampered.
    writeFileSync(ts.files[0]!, '// gutted\n', 'utf-8')
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
  })

  it('fails (exit 2) when an untracked *-gauntlet.* artifact is left in outDir (#1644)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const spec = writeSpec(dir)
    const outDir = join(dir, 'out')
    runGauntletGenerate({ spec, out: outDir, stack: 'typescript' })
    // A stale artifact no longer enumerated by the manifest must be caught.
    writeFileSync(join(outDir, 'rogue-gauntlet.rs'), 'fn main() {}\n', 'utf-8')
    const result = runGauntletVerify({ spec, out: outDir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toMatch(/untracked|unexpected/i)
  })
})
