// SPDX-License-Identifier: Apache-2.0
// Per-evaluation memoization for the conformance engine (#1522).
//
// The engine must (a) compile a glob's RegExp ONCE per check — not once per scanned file — and
// (b) walk the repo tree ONCE per evaluate(), shared across every glob-based check, instead of
// re-walking the whole tree on every check. Both are output-invariant (verdicts/score unchanged),
// so the engine-parity gate stays green; this suite locks the algorithmic contract directly.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { evaluate, type RegistryInput } from '../../src/conformance/engine.js'
import * as shared from '../../src/conformance/shared.js'

const created: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'engine-memo-'))
  created.push(dir)
  return dir
}

describe('glob compiled once per check (#1522)', () => {
  it('globMatch behaviour is preserved after the compile-once refactor', () => {
    // `**` crosses directory boundaries; `*` stays within one path component.
    expect(shared.globMatch('src/**/*.ts', 'src/a.ts')).toBe(true)
    expect(shared.globMatch('src/**/*.ts', 'src/deep/b.ts')).toBe(true)
    expect(shared.globMatch('src/**/*.ts', 'src/a.js')).toBe(false)
    expect(shared.globMatch('src/*.ts', 'src/deep/b.ts')).toBe(false)
    expect(shared.globMatch('src/*.ts', 'other/a.ts')).toBe(false)
  })

  it('expandGlob filters an INJECTED file list (no tree-walk) when one is supplied', () => {
    const root = tmpRoot() // intentionally empty on disk
    // The injected list has files that do NOT exist on disk — proving expandGlob filtered the
    // injected list, not a fresh walk of the (empty) root.
    const injected = ['src/b.ts', 'src/a.ts', 'src/keep.js', 'README.md']
    const out = shared.expandGlob(root, 'src/**/*.ts', injected)
    expect(out).toEqual(['src/a.ts', 'src/b.ts']) // sorted, only the .ts matches
  })
})

describe('evaluate() walks the repo tree ONCE per call (#1522)', () => {
  it('shares a single walkRepo across multiple glob checks', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
    writeFileSync(join(root, 'bin', 'run.sh'), '#!/bin/sh\n')

    const walkSpy = vi.spyOn(shared, 'walkRepo')
    const reg: RegistryInput = {
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
    const walkSpy = vi.spyOn(shared, 'walkRepo')
    const reg: RegistryInput = {
      checks: [{ id: 'A', type: 'file_exists', args: { path: 'README.md' } }],
    }
    evaluate(reg, new Set<string>(), root)
    expect(walkSpy).not.toHaveBeenCalled()
  })
})
