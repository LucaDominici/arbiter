// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-no-work-refs.mjs')

function run(mode: string, cwd: string) {
  const r = spawnSync('node', [SCRIPT, mode], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'work-refs-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Forbidden provenance tokens are built at runtime so the literals never appear
// verbatim in committed source (the privacy gate scans this file in "all" mode).
const WORK_TOKEN = ['main', 'sim'].join('')
const WORK_TOKEN_SHORT = ['ms', '5'].join('')

describe('check-no-work-refs.mjs (privacy gate)', () => {
  it('exits 0 in the real repo with mode "all" (no private work-repo strings)', () => {
    const result = run('all', resolve('.'))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[check-no-work-refs] OK')
  })

  it('exits 1 when a file contains a forbidden work-repo hostname token', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Initialize minimal git repo
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })

      // Create a file with forbidden pattern
      writeFileSync(
        join(dir, 'leaked.ts'),
        `export const url = "https://${WORK_TOKEN}.example.com"\n`,
      )

      // Add to git index so getStagedFiles finds it
      spawnSync('git', ['add', 'leaked.ts'], { cwd: dir, stdio: 'ignore' })

      const result = run('staged', dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[check-no-work-refs] FAIL')
      expect(result.stderr).toContain(WORK_TOKEN)
      expect(result.stderr).toContain('leaked.ts')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a file contains a forbidden short work-repo token', () => {
    const { dir, cleanup } = makeTemp()
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })

      writeFileSync(join(dir, 'config.yml'), `endpoint: ${WORK_TOKEN_SHORT}.internal\n`)
      spawnSync('git', ['add', 'config.yml'], { cwd: dir, stdio: 'ignore' })

      const result = run('staged', dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[check-no-work-refs] FAIL')
      expect(result.stderr).toContain(WORK_TOKEN_SHORT)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when staged files contain no forbidden patterns', () => {
    const { dir, cleanup } = makeTemp()
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })

      writeFileSync(join(dir, 'clean.ts'), 'export const url = "https://example.com"\n')
      spawnSync('git', ['add', 'clean.ts'], { cwd: dir, stdio: 'ignore' })

      const result = run('staged', dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-no-work-refs] OK')
    } finally {
      cleanup()
    }
  })

  it('skips files matching SKIP_PATHS (check-no-work-refs.mjs itself)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })

      // Create scripts/check-no-work-refs.mjs with forbidden pattern — should be skipped
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts/check-no-work-refs.mjs'),
        `// FORBIDDEN: ${WORK_TOKEN} is in the pattern list\n`,
      )
      spawnSync('git', ['add', 'scripts/check-no-work-refs.mjs'], { cwd: dir, stdio: 'ignore' })

      const result = run('staged', dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-no-work-refs] OK')
    } finally {
      cleanup()
    }
  })

  it('only scans files with recognized extensions', () => {
    const { dir, cleanup } = makeTemp()
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })

      // Binary file with forbidden pattern — should be ignored
      writeFileSync(join(dir, 'binary.bin'), WORK_TOKEN)
      spawnSync('git', ['add', 'binary.bin'], { cwd: dir, stdio: 'ignore' })

      const result = run('staged', dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-no-work-refs] OK')
    } finally {
      cleanup()
    }
  })
})
