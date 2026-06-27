// SPDX-License-Identifier: Apache-2.0
// #1638 — the emitted FE boundary purity scanner (check-fe-boundaries.mjs, INV-102/103/104) walks
// the project's src/ tree with a hand-rolled recursive walkSrc(). Before the fix it used
// statSync() (which FOLLOWS symlinks), a plain readdirSync() (no withFileTypes), and recursed with
// NO visited-set and NO isSymbolicLink() skip — so a symlinked source file was followed/read and a
// directory-symlink cycle under src/ recursed forever and OOM-ed the consumer's CI / PostToolUse
// hook. This was the gap left by the #1555 sweep (which only hardened the three boundaries/ scanners).
// This render+execute test stages the rendered scanner in a temp project whose src/ contains a
// directory-symlink cycle AND a symlinked source file, then proves the scanner:
//   - TERMINATES within budget without a stack-overflow (cycle guard present),
//   - STILL reports a real (non-symlink) raw-HTTP violation (anti-vacuous — scan not disarmed),
//   - does NOT follow a symlinked source file pointing at a banned HTTP call (isSymbolicLink skip).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-fe-boundaries.mjs.ejs', data)
}

describe('#1638 FE boundary scanner is cycle-safe and skips symlinked sources', () => {
  it('terminates on a src/ symlink cycle and does not follow symlinked sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fe-boundary-cycle-'))
    try {
      const srcAbs = join(dir, 'src')
      mkdirSync(srcAbs, { recursive: true })
      // A clean real source (no raw HTTP call).
      writeFileSync(join(srcAbs, 'clean.ts'), 'export const x = 1\n')
      // A REAL raw-HTTP call in a real, non-adapter file — proves the scan still fires (INV-102).
      writeFileSync(join(srcAbs, 'realbad.ts'), "export const r = fetch('/api/x')\n")
      // A source file OUTSIDE src/ holding a raw-HTTP call, reached only via a symlink.
      writeFileSync(join(dir, 'outside.ts'), "export const o = fetch('/api/y')\n")
      symlinkSync(join(dir, 'outside.ts'), join(srcAbs, 'linked.ts'), 'file')
      // A directory symlink cycle back to src/ → would recurse forever in a naive walker.
      symlinkSync(srcAbs, join(srcAbs, 'loop'), 'dir')

      const scanner = join(dir, 'check-fe-boundaries.mjs')
      writeFileSync(scanner, render())

      const res = spawnSync('node', [scanner], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 10_000,
      })

      // Terminated normally (not killed by the timeout signal → no infinite recursion / hang).
      expect(res.signal).toBeNull()
      const out = `${res.stdout}${res.stderr}`
      // No stack-overflow from an unguarded cycle.
      expect(out).not.toContain('Maximum call stack size exceeded')
      // The REAL raw-HTTP call is still reported (scan not disarmed).
      expect(out).toContain('realbad.ts')
      // The SYMLINKED source is NOT followed (RED before the fix: it was read and reported).
      expect(out).not.toContain('linked.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders cleanly and carries the cycle-safety guard', () => {
    const out = render()
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out).toContain('isSymbolicLink()')
    expect(out).toContain('withFileTypes: true')
    // No relative/library import — must run in a project with no arbiter install.
    expect(out).not.toMatch(/from '\.\.?\//)
  })
})
