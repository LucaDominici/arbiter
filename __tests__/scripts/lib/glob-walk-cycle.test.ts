// SPDX-License-Identifier: Apache-2.0
// Cycle-safety regression for the shared .mjs walker (scripts/lib/glob-walk.mjs), #1521.
//
// walkRepo is the SSOT tree-walk for the presence-gate scripts. It must terminate on a directory
// symlink cycle in an arbitrary scanned repo: it records a symlinked directory once (so file/stat
// checks can still evaluate it via their own lstat) but NEVER recurses into it, and additionally
// tracks visited device:inode so a real-path cycle (hardlink / bind-mount) also terminates.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
// Import the real .mjs SSOT (not a re-implementation) so the test guards the shipped file.
const { walkRepo } = (await import(join(REPO_ROOT, 'scripts/lib/glob-walk.mjs'))) as {
  walkRepo: (root: string) => string[]
}

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'glob-walk-cycle-'))
  created.push(dir)
  return dir
}

describe('walkRepo cycle-safety (#1521)', () => {
  it('TERMINATES on a branching directory symlink cycle and does not descend it', () => {
    // Two directory symlinks back at the root → branching factor 2. A follow-symlinks walker fans
    // out to ~2^40 phantom paths before the OS symlink limit (a hang / OOM); the hardened walker
    // records each symlink once and never traverses it. 5s budget — the fix completes in ~ms.
    const root = tmpRoot()
    writeFileSync(join(root, 'real.txt'), 'x')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'nested.txt'), 'y')
    symlinkSync(root, join(root, 'loopA'), 'dir')
    symlinkSync(root, join(root, 'loopB'), 'dir')

    let files: string[] = []
    expect(() => {
      files = walkRepo(root)
    }).not.toThrow()

    // Real files are discovered exactly once.
    expect(files).toContain('real.txt')
    expect(files).toContain('sub/nested.txt')
    // The symlinks are recorded as leaf entries...
    expect(files).toContain('loopA')
    expect(files).toContain('loopB')
    // ...but NEVER descended (no path threads through a symlink back into the tree).
    expect(files.some((f) => f.includes('loopA/') || f.includes('loopB/'))).toBe(false)
  }, 5000)
})
