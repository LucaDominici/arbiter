// SPDX-License-Identifier: Apache-2.0
// #2039: the parity gate that keeps METHODOLOGY_CATALOG honest against ALLOWED_PATHS.
//
// Planted-bad / planted-clean throughout: a gate proven only green is ceremony. Each case
// mutates ONE thing in a synthetic pair of sources and asserts the gate flips, so a parser
// that silently stops matching cannot leave this suite passing.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = resolve('scripts/check-methodology-coverage.mjs')

const roots: string[] = []
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configureSrc(paths: string[]): string {
  return `export const ALLOWED_PATHS = new Set([\n${paths.map((p) => `  '${p}',`).join('\n')}\n])\n`
}

function methodSrc(rows: string[][], excluded: Array<[string, string]>): string {
  return (
    `export const NON_METHODOLOGY_PATHS = new Map([\n` +
    excluded.map(([p, r]) => `  ['${p}', '${r}'],`).join('\n') +
    `\n])\n\n` +
    `export const METHODOLOGY_CATALOG = [\n` +
    rows
      .map(
        (row, i) =>
          `  { id: 'M-${i}', cluster: 'testing', name: 'r${i}', configPaths: [${row
            .map((p) => `'${p}'`)
            .join(', ')}] },`,
      )
      .join('\n') +
    `\n]\n`
  )
}

function fixture(
  allowed: string[],
  rows: string[][],
  excluded: Array<[string, string]> = [],
): string {
  const root = mkdtempSync(join(tmpdir(), 'method-parity-'))
  roots.push(root)
  mkdirSync(join(root, 'src', 'commands'), { recursive: true })
  writeFileSync(join(root, 'src', 'commands', 'configure.ts'), configureSrc(allowed))
  writeFileSync(join(root, 'src', 'commands', 'method.ts'), methodSrc(rows, excluded))
  return root
}

function run(root: string): { status: number | null; out: string } {
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('check-methodology-coverage.mjs (#2039)', () => {
  it('PASSES on a catalog that lenses every settable path', () => {
    const { status, out } = run(fixture(['a', 'b.c'], [['a'], ['b.c']]))
    expect(status, out).toBe(0)
  })

  it('PASSES when the residue is explicitly excluded with a reason', () => {
    const { status, out } = run(fixture(['a', 'shape'], [['a']], [['shape', 'project shape']]))
    expect(status, out).toBe(0)
  })

  it('FAILS on a row bound to a path configure would reject', () => {
    const { status, out } = run(fixture(['a'], [['a'], ['ghost']]))
    expect(status).toBe(1)
    expect(out).toMatch(/NOT SETTABLE/)
    expect(out).toContain('ghost')
  })

  it('FAILS on a settable path that is neither lensed nor excluded', () => {
    const { status, out } = run(fixture(['a', 'forgotten'], [['a']]))
    expect(status).toBe(1)
    expect(out).toMatch(/UNLENSED/)
    expect(out).toContain('forgotten')
  })

  it('FAILS on a path claimed by two rows — one dial, one owner', () => {
    const { status, out } = run(fixture(['a'], [['a'], ['a']]))
    expect(status).toBe(1)
    expect(out).toMatch(/DUPLICATE/)
  })

  it('FAILS on a stale exclusion — it pre-approves omitting a path that is gone', () => {
    const { status, out } = run(fixture(['a'], [['a']], [['removed', 'was project shape']]))
    expect(status).toBe(1)
    expect(out).toMatch(/STALE EXCLUSION/)
  })

  it('FAILS on an exclusion with no reason — a bare path explains nothing', () => {
    const { status, out } = run(fixture(['a', 'shape'], [['a']], [['shape', '']]))
    expect(status).toBe(1)
    expect(out).toMatch(/no reason/)
  })

  // Fail-closed: a source whose shape changed must ERROR (2), not pass vacuously (0).
  it('ERRORS with exit 2 when ALLOWED_PATHS cannot be extracted', () => {
    const root = fixture(['a'], [['a']])
    writeFileSync(join(root, 'src', 'commands', 'configure.ts'), '// shape changed\n')
    const { status, out } = run(root)
    expect(status).toBe(2)
    expect(out).toMatch(/ERROR/)
  })

  it('ERRORS with exit 2 when METHODOLOGY_CATALOG cannot be extracted', () => {
    const root = fixture(['a'], [['a']])
    writeFileSync(join(root, 'src', 'commands', 'method.ts'), '// shape changed\n')
    const { status } = run(root)
    expect(status).toBe(2)
  })

  it("PASSES against arbiter's own tree", () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
  })
})
