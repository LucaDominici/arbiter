// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const SCRIPT = resolve('scripts/check-private-paths-ignored.mjs')

function makeGitRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'private-paths-test-'))
  // Initialize a bare minimum git repo so git check-ignore works
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], {
    cwd: dir,
    stdio: 'pipe',
  })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(gitRepoDir: string) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: gitRepoDir,
    env: { ...process.env, ARBITER_HOOK_GIT_CWD: gitRepoDir },
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

describe('check-private-paths-ignored.mjs (private paths gitignore enforcement)', () => {
  it('exits 0 when all private paths are gitignored and committed paths are not', () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      // Write a .gitignore that ignores the private paths
      writeFileSync(
        join(dir, '.gitignore'),
        `.arbiter/private/
docs/internal/KIT-GOLD-STANDARD.md
src/kit/derived.json
`,
      )

      // Create the private paths (they should be ignored)
      mkdirSync(join(dir, '.arbiter', 'private', 'work-kit-source'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'work-kit-source', 'x.md'), 'private')
      mkdirSync(join(dir, '.arbiter', 'private'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'REDACTION-LEXICON.md'), 'private')
      mkdirSync(join(dir, 'docs', 'internal'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'KIT-GOLD-STANDARD.md'), 'private')
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'derived.json'), 'private')

      // Create the committed paths (they must NOT be ignored)
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'data', 'redaction-lexicon.json'), 'committed')
      writeFileSync(join(dir, '.kit-removals.log'), 'committed')

      // Add committed files to git index (so they are "committed", not ignored)
      execFileSync('git', ['add', 'scripts/data/redaction-lexicon.json', '.kit-removals.log'], {
        cwd: dir,
        stdio: 'pipe',
      })

      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a private path is not gitignored', () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      // Write .gitignore that does NOT ignore .arbiter/private
      writeFileSync(
        join(dir, '.gitignore'),
        `docs/internal/KIT-GOLD-STANDARD.md
src/kit/derived.json
`,
      )

      // Create all paths
      mkdirSync(join(dir, '.arbiter', 'private', 'work-kit-source'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'work-kit-source', 'x.md'), 'not ignored')
      mkdirSync(join(dir, '.arbiter', 'private'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'REDACTION-LEXICON.md'), 'not ignored')
      mkdirSync(join(dir, 'docs', 'internal'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'KIT-GOLD-STANDARD.md'), 'ignored')
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'derived.json'), 'ignored')
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'data', 'redaction-lexicon.json'), 'committed')
      writeFileSync(join(dir, '.kit-removals.log'), 'committed')

      // Add committed files to git
      execFileSync('git', ['add', 'scripts/data/redaction-lexicon.json', '.kit-removals.log'], {
        cwd: dir,
        stdio: 'pipe',
      })

      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('should be gitignored')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a committed path is gitignored', () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      // Write .gitignore that ignores the committed paths (this is the violation)
      writeFileSync(
        join(dir, '.gitignore'),
        `.arbiter/private/
docs/internal/KIT-GOLD-STANDARD.md
src/kit/derived.json
scripts/data/
.kit-removals.log
`,
      )

      // Create all paths
      mkdirSync(join(dir, '.arbiter', 'private', 'work-kit-source'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'work-kit-source', 'x.md'), 'private')
      mkdirSync(join(dir, '.arbiter', 'private'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'private', 'REDACTION-LEXICON.md'), 'private')
      mkdirSync(join(dir, 'docs', 'internal'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'internal', 'KIT-GOLD-STANDARD.md'), 'private')
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'derived.json'), 'private')
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'data', 'redaction-lexicon.json'), 'should not be ignored')
      writeFileSync(join(dir, '.kit-removals.log'), 'should not be ignored')

      // Try to add committed files to git (git will not track them because they're ignored)
      // We still call run to test the gate
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('is gitignored but must be committed')
    } finally {
      cleanup()
    }
  })
})
