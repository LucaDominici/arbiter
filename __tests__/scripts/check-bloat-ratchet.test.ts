// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-bloat-ratchet.mjs')

function run(env?: Record<string, string>) {
  // ALLOW_BLOAT is a session-scoped bypass (CONTRIBUTING.md). Inherited from the
  // ambient environment it would silence the ratchet in the child and turn the
  // real-ratchet assertions below into a false red, so scrub it and let each case
  // opt in explicitly via `env`.
  const base = { ...process.env }
  delete base.ALLOW_BLOAT
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: resolve('.'),
    env: { ...base, ...env },
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function runIn(directory: string) {
  const base = { ...process.env }
  delete base.ALLOW_BLOAT
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: directory,
    env: base,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function git(directory: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf-8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function writeTemplateFiles(directory: string, names: string[]) {
  const templates = join(directory, 'src/templates')
  mkdirSync(templates, { recursive: true })
  for (const name of names) writeFileSync(join(templates, `${name}.ejs`), '<%= value %>')
}

function writeBaseline(directory: string, templateFiles: number) {
  writeFileSync(
    join(directory, '.bloat-baseline.json'),
    JSON.stringify({
      capturedAt: '2026-01-01T00:00:00.000Z',
      buckets: {
        srcDirect: { files: 0, loc: 0 },
        generators: { files: 0, loc: 0 },
        commands: { files: 0, loc: 0 },
        templates: { files: templateFiles, loc: templateFiles },
      },
    }),
  )
}

function commit(directory: string, message: string) {
  git(directory, ['add', '.'])
  git(directory, ['commit', '-m', message])
}

function createBranchAtTemplateLimit() {
  const directory = mkdtempSync(join(tmpdir(), 'check-bloat-ratchet-'))
  git(directory, ['init'])
  git(directory, ['config', 'user.email', 'test@example.com'])
  git(directory, ['config', 'user.name', 'Test User'])

  const baseFiles = Array.from({ length: 100 }, (_, index) => `base-${index}`)
  writeTemplateFiles(directory, baseFiles)
  writeBaseline(directory, baseFiles.length)
  commit(directory, 'base')
  const baseSha = git(directory, ['rev-parse', 'HEAD'])

  git(directory, ['checkout', '-b', 'feature'])
  writeTemplateFiles(directory, ['branch-1', 'branch-2', 'branch-3'])
  commit(directory, 'branch at template limit')

  return { directory, baseSha }
}

describe('check-bloat-ratchet.mjs (CANON-16 / INV-46 — file-count + LOC ratchet)', () => {
  it('exits 0 when run against repo root with clean baseline', () => {
    const result = run()
    expect(result.status).toBe(0)
  })

  it('exits 0 when ALLOW_BLOAT=1 is set (bypass)', () => {
    const result = run({ ALLOW_BLOAT: '1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('ALLOW_BLOAT=1')
  })

  it('outputs success message on clean ratchet', () => {
    const result = run()
    expect(result.stdout).toContain('ratchet OK')
  })

  it('merge result over the limit is red although the branch alone is under it', () => {
    const { directory, baseSha } = createBranchAtTemplateLimit()
    try {
      git(directory, ['checkout', '-b', 'upstream', baseSha])
      writeTemplateFiles(directory, ['upstream-1', 'upstream-2'])
      commit(directory, 'advance main independently')
      const upstreamSha = git(directory, ['rev-parse', 'HEAD'])
      git(directory, ['update-ref', 'refs/remotes/origin/main', upstreamSha])
      git(directory, ['checkout', 'feature'])

      const result = runIn(directory)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('templates')
      expect(result.stderr).toContain('merge result')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('branch up to date with origin/main is unaffected', () => {
    const { directory, baseSha } = createBranchAtTemplateLimit()
    try {
      git(directory, ['update-ref', 'refs/remotes/origin/main', baseSha])

      const result = runIn(directory)

      expect(result.status).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('no origin/main -> no merge-result check, no false red', () => {
    const { directory } = createBranchAtTemplateLimit()
    try {
      const result = runIn(directory)

      expect(result.status).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
