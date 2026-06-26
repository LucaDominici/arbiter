// SPDX-License-Identifier: Apache-2.0
// Per-evaluation memoization for the .mjs gold-audit engine (#1600).
//
// The #1522 fix (compile a glob's RegExp once per check; walk the repo tree once per evaluate(),
// shared across every glob check) landed only in the TS engine. This mirrors it into the .mjs
// reference that scripts/gold-audit.mjs actually runs in CI/gates. Both are output-invariant, so
// the engine-parity gate cannot see the divergence; this suite pins the algorithmic contract
// directly: K glob checks ⇒ ONE walkRepo, and zero glob checks ⇒ ZERO walks.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { evaluate } from '../../scripts/lib/gold-audit-lib.mjs'
import * as globWalk from '../../scripts/lib/glob-walk.mjs'

const created: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gold-memo-'))
  created.push(dir)
  return dir
}

describe('glob compiled once per check (.mjs #1600)', () => {
  it('exposes globToRegExp and preserves globMatch behaviour after the compile-once split', () => {
    expect(typeof globWalk.globToRegExp).toBe('function')
    // `**` crosses directory boundaries; `*` stays within one path component.
    expect(globWalk.globMatch('src/**/*.ts', 'src/a.ts')).toBe(true)
    expect(globWalk.globMatch('src/**/*.ts', 'src/deep/b.ts')).toBe(true)
    expect(globWalk.globMatch('src/**/*.ts', 'src/a.js')).toBe(false)
    expect(globWalk.globMatch('src/*.ts', 'src/deep/b.ts')).toBe(false)
    expect(globWalk.globMatch('src/*.ts', 'other/a.ts')).toBe(false)
  })
})

describe('evaluate() walks the repo tree ONCE per call (.mjs #1600)', () => {
  it('shares a single walkRepo across multiple glob checks', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
    writeFileSync(join(root, 'bin', 'run.sh'), '#!/bin/sh\n')

    const walkSpy = vi.spyOn(globWalk, 'walkRepo')
    const reg = {
      checks: [
        { id: 'FP-1', type: 'forbidden_pattern', args: { glob: 'src/**/*.ts', pattern: 'NOPE' } },
        { id: 'FP-2', type: 'forbidden_pattern', args: { glob: 'src/**/*.ts', pattern: 'ALSO' } },
        { id: 'FS-1', type: 'file_stat', args: { glob: 'bin/*.sh' } },
      ],
    }
    evaluate(reg, new Set<string>(), root)
    // three glob checks, but the tree is walked exactly once for the whole evaluate().
    expect(walkSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT walk the tree when no glob check is present (K=0 ⇒ 0 walks)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'README.md'), '# r\n')
    const walkSpy = vi.spyOn(globWalk, 'walkRepo')
    const reg = {
      checks: [{ id: 'A', type: 'file_exists', args: { path: 'README.md' } }],
    }
    evaluate(reg, new Set<string>(), root)
    expect(walkSpy).not.toHaveBeenCalled()
  })

  it('does NOT walk when a glob check has an empty/invalid glob (no getFiles() trigger)', () => {
    const root = tmpRoot()
    const walkSpy = vi.spyOn(globWalk, 'walkRepo')
    const reg = {
      // empty glob ⇒ resolveGlobArg short-circuits to null BEFORE calling getFiles()
      checks: [{ id: 'FP-EMPTY', type: 'forbidden_pattern', args: { glob: '', pattern: 'x' } }],
    }
    const result = evaluate(reg, new Set<string>(), root) as { checks: Array<{ verdict: string }> }
    expect(result.checks[0]?.verdict).toBe('N') // invalid/empty glob ⇒ N (unchanged behaviour)
    expect(walkSpy).not.toHaveBeenCalled()
  })
})
