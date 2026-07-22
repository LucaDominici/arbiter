// SPDX-License-Identifier: Apache-2.0
// Exercises scripts/check-reuse-survey.mjs (INV-70, minimal advisory reuse-survey gate).
//
// Range-scan tests are HERMETIC: each builds a throwaway git repo (mktemp + git init +
// controlled commits) and drives the gate via --range against THAT range, so they never
// depend on the live repo's origin/main..HEAD. The gate warns (exit 1) when a commit adds
// a new file under src/ or scripts/ without documenting the CANON-16 existing-code survey.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-reuse-survey.mjs')

function run(args: string[], cwd: string) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd, timeout: 15000 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function git(dir: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? ''}`)
}

interface Repo {
  dir: string
  cleanup: () => void
}

/** Build a repo with a base commit, then a tip commit that adds `addPath` with `message`. */
function repo(addPath: string, message: string): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'reuse-survey-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 't@t.t'])
  git(dir, ['config', 'user.name', 't'])
  writeFileSync(join(dir, 'README.md'), '# base\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'base'])
  const abs = join(dir, addPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, 'export const x = 1\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', message])
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const RANGE = ['--range=HEAD~1..HEAD']

describe('check-reuse-survey.mjs — marker validation (--test-marker)', () => {
  it('accepts a documented survey marker', () => {
    const r = run(
      ['--test-marker=Existing Code Survey: checked REUSE_REGISTRY, no similar entry.'],
      process.cwd(),
    )
    expect(r.status).toBe(0)
  })

  it('rejects a message with no survey marker', () => {
    const r = run(['--test-marker=feat: add a new helper'], process.cwd())
    expect(r.status).toBe(1)
  })
})

describe('check-reuse-survey.mjs — range scan (hermetic)', () => {
  it('warns when a new src/ file is added without the survey marker', () => {
    const rp = repo('src/foo.ts', 'feat: add foo helper')
    try {
      const r = run(RANGE, rp.dir)
      expect(r.status).toBe(1)
    } finally {
      rp.cleanup()
    }
  })

  it('passes when a new src/ file carries the survey marker in its message', () => {
    const rp = repo(
      'src/foo.ts',
      'feat: add foo helper\n\nExisting Code Survey: checked REUSE_REGISTRY, no similar entry.',
    )
    try {
      const r = run(RANGE, rp.dir)
      expect(r.status).toBe(0)
    } finally {
      rp.cleanup()
    }
  })

  it('passes when the added file is outside src/ and scripts/', () => {
    const rp = repo('docs/notes.md', 'docs: add notes')
    try {
      const r = run(RANGE, rp.dir)
      expect(r.status).toBe(0)
    } finally {
      rp.cleanup()
    }
  })

  it('warns when a new scripts/ file is added without the marker', () => {
    const rp = repo('scripts/thing.mjs', 'chore: add script')
    try {
      const r = run(RANGE, rp.dir)
      expect(r.status).toBe(1)
    } finally {
      rp.cleanup()
    }
  })

  it('exits 0 (skip) when the range is unresolvable', () => {
    const rp = repo('src/foo.ts', 'feat: add foo helper')
    try {
      const r = run(['--range=origin/nonexistent..HEAD'], rp.dir)
      expect(r.status).toBe(0)
    } finally {
      rp.cleanup()
    }
  })
})
