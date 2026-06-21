// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-install-command.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'install-cmd-test-'))
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  // The gate runs from scripts/ relative to cwd; copy it in so it resolves.
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  cpSync(SCRIPT, join(dir, 'scripts/check-install-command.mjs'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function write(dir: string, rel: string, content: string) {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  spawnSync('git', ['add', rel], { cwd: dir, stdio: 'ignore' })
}

describe('check-install-command.mjs (B1 install-command gate)', () => {
  it('passes against the real repo (no unscoped install commands ship)', () => {
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[check-install-command] OK')
  })

  it('FAILS on an unscoped `npx arbiter` command in README', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(dir, 'README.md', '# Install\n\n```bash\nnpx arbiter init\n```\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[check-install-command] FAIL')
      expect(result.stderr).toContain('npx arbiter')
    } finally {
      cleanup()
    }
  })

  it('FAILS on `npm install -g arbiter` and `npm install arbiter@beta`', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(dir, 'website/changelog/beta.md', 'Run `npm install arbiter@beta` to try it.\n')
      write(dir, 'docs/SETUP.md', 'Then `npm install -g arbiter` globally.\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('npm install arbiter@beta')
      expect(result.stderr).toContain('npm install -g arbiter')
    } finally {
      cleanup()
    }
  })

  it('PASSES on the scoped `npx @arbiter/cli` form', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(dir, 'README.md', '```bash\nnpx @arbiter/cli init\nnpm install -g @arbiter/cli\n```\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-install-command] OK')
    } finally {
      cleanup()
    }
  })

  it('PASSES when an unscoped form is marked with the install-command-allow sentinel', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'docs/PITFALLS.md',
        '<!-- install-command-allow -->\nDo NOT run `npx arbiter init` — it fetches an unrelated package.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-install-command] OK')
    } finally {
      cleanup()
    }
  })

  it('does not scan non-user-facing files (e.g. src/)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(dir, 'src/notes.md', 'npx arbiter init\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
