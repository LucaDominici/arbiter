// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// check-id-stability.mjs (#610) fails (exit 1) when a catalog ID present in
// origin/main is removed from HEAD without a status:"retired" marker. It runs
// against process.cwd() and diffs the working repo's HEAD vs origin/main, so
// each test builds a throwaway git repo with a bare "origin" remote and runs
// the script with cwd pointed at it. Exit contract: 0 = stable/no-op, 1 = ID
// removed without retire marker. There is no exit-2 path.
const SCRIPT = resolve('scripts/check-id-stability.mjs')

function catalog(entries: Array<{ id: string; status: string; retiredReason?: string }>): string {
  const body = entries
    .map((e) => {
      const lines = [`    id: '${e.id}',`, `    status: '${e.status}',`]
      if (e.retiredReason) lines.push(`    retiredReason: '${e.retiredReason}',`)
      return `  {\n${lines.join('\n')}\n  },`
    })
    .join('\n')
  return `export const catalog = [\n${body}\n]\n`
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if ((r.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? ''}`)
  }
  return r
}

/**
 * Build a temp repo whose origin/main catalog contains `originEntries`, then
 * commit `headEntries` on HEAD. Returns the work dir + cleanup.
 */
function makeRepo(
  originEntries: Array<{ id: string; status: string; retiredReason?: string }>,
  headEntries: Array<{ id: string; status: string; retiredReason?: string }> | null,
): { work: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'idstab-test-'))
  const bare = join(base, 'origin-bare')
  const work = join(base, 'work')
  mkdirSync(bare, { recursive: true })
  mkdirSync(work, { recursive: true })

  git(bare, 'init', '-q', '--bare')

  git(work, 'init', '-q')
  git(work, 'config', 'user.email', 't@example.com')
  git(work, 'config', 'user.name', 'test')
  git(work, 'config', 'commit.gpgsign', 'false')
  mkdirSync(join(work, 'src', 'invariants'), { recursive: true })
  writeFileSync(join(work, 'src/invariants/catalog.ts'), catalog(originEntries))
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'init')
  git(work, 'branch', '-M', 'main')
  git(work, 'remote', 'add', 'origin', bare)
  git(work, 'push', '-q', 'origin', 'main')
  git(work, 'fetch', '-q', 'origin')

  // Optionally mutate the catalog on HEAD (a new commit) so it differs from origin/main.
  if (headEntries) {
    writeFileSync(join(work, 'src/invariants/catalog.ts'), catalog(headEntries))
    git(work, 'add', '-A')
    git(work, 'commit', '-qm', 'mutate catalog')
  }

  return { work, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-id-stability.mjs (catalog ID retirement gate, #610)', () => {
  it('exits 0 when the catalog is unchanged vs origin/main', () => {
    const { work, cleanup } = makeRepo(
      [
        { id: 'INV-01', status: 'active' },
        { id: 'INV-02', status: 'active' },
      ],
      null, // HEAD == origin/main
    )
    try {
      // catalog.ts does not appear in the diff → early no-op exit 0
      expect(run(work).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a removed ID is marked status:"retired" (accounted for)', () => {
    const { work, cleanup } = makeRepo(
      [
        { id: 'INV-01', status: 'active' },
        { id: 'INV-02', status: 'active' },
      ],
      [
        { id: 'INV-01', status: 'active' },
        { id: 'INV-02', status: 'retired', retiredReason: 'superseded' },
      ],
    )
    try {
      const result = run(work)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('PASS')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an active ID is removed from the catalog without a retire marker', () => {
    const { work, cleanup } = makeRepo(
      [
        { id: 'INV-01', status: 'active' },
        { id: 'INV-02', status: 'active' },
      ],
      [{ id: 'INV-01', status: 'active' }], // INV-02 deleted outright
    )
    try {
      const result = run(work)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('INV-02')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when origin/main has no catalog history (nothing to compare)', () => {
    // Build a repo whose catalog lives at a path origin/main never tracked:
    // origin lacks src/invariants/catalog.ts entirely → script exits 0 early.
    const base = mkdtempSync(join(tmpdir(), 'idstab-test-'))
    const bare = join(base, 'origin-bare')
    const work = join(base, 'work')
    try {
      mkdirSync(bare, { recursive: true })
      mkdirSync(work, { recursive: true })
      git(bare, 'init', '-q', '--bare')
      git(work, 'init', '-q')
      git(work, 'config', 'user.email', 't@example.com')
      git(work, 'config', 'user.name', 'test')
      git(work, 'config', 'commit.gpgsign', 'false')
      writeFileSync(join(work, 'readme.md'), '# x\n')
      git(work, 'add', '-A')
      git(work, 'commit', '-qm', 'init')
      git(work, 'branch', '-M', 'main')
      git(work, 'remote', 'add', 'origin', bare)
      git(work, 'push', '-q', 'origin', 'main')
      git(work, 'fetch', '-q', 'origin')
      // Now add a catalog on HEAD only.
      mkdirSync(join(work, 'src', 'invariants'), { recursive: true })
      writeFileSync(
        join(work, 'src/invariants/catalog.ts'),
        catalog([{ id: 'INV-01', status: 'active' }]),
      )
      git(work, 'add', '-A')
      git(work, 'commit', '-qm', 'add catalog')
      expect(run(work).status).toBe(0)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
