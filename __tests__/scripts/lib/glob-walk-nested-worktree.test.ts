// SPDX-License-Identifier: Apache-2.0
// Nested-checkout regression for the shared .mjs walker (scripts/lib/glob-walk.mjs), #1734/#1752.
//
// walkRepo is the SSOT tree-walk for the presence-gate scripts (check-doc-links, check-doc-style,
// etc). A subdirectory that itself contains a `.git` entry (file OR dir — a git worktree's `.git`
// is a FILE pointing at the shared gitdir, a plain clone's `.git` is a directory) is a SEPARATE
// checkout, not part of THIS repo's tree. Descending into it produces thousands of false
// "broken link" / doc-style hits from an agent worktree materialized under `.claude/worktrees/**`
// that exist ONLY locally (CI's clean checkout has no nested worktrees).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
  const dir = mkdtempSync(join(tmpdir(), 'glob-walk-nested-worktree-'))
  created.push(dir)
  return dir
}

describe('walkRepo nested-checkout skip (#1734/#1752)', () => {
  it('does NOT descend into a subdirectory whose .git is a FILE (git worktree layout)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'real.md'), '# real')
    // Simulate `.claude/worktrees/agent-xyz/` — a nested git worktree checkout.
    const worktreeDir = join(root, '.claude', 'worktrees', 'agent-xyz')
    mkdirSync(worktreeDir, { recursive: true })
    writeFileSync(join(worktreeDir, '.git'), 'gitdir: /some/where/.git/worktrees/agent-xyz\n')
    writeFileSync(join(worktreeDir, 'nested.md'), '# nested, belongs to the OTHER checkout')

    const files = walkRepo(root)

    expect(files).toContain('real.md')
    // The nested worktree's own content must never surface in THIS repo's walk.
    expect(files.some((f) => f.includes('nested.md'))).toBe(false)
    expect(files.some((f) => f.startsWith('.claude/worktrees/agent-xyz/'))).toBe(false)
  })

  it('does NOT descend into a subdirectory whose .git is a DIRECTORY (plain nested clone/submodule)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'real.md'), '# real')
    const subCloneDir = join(root, 'vendor', 'some-submodule')
    mkdirSync(join(subCloneDir, '.git'), { recursive: true })
    writeFileSync(join(subCloneDir, 'nested.md'), '# nested, belongs to the submodule')

    const files = walkRepo(root)

    expect(files).toContain('real.md')
    expect(files.some((f) => f.includes('nested.md'))).toBe(false)
  })

  it('still walks normal subdirectories that do not contain a .git entry', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'guide.md'), '# guide')

    const files = walkRepo(root)

    expect(files).toContain('docs/guide.md')
  })
})
