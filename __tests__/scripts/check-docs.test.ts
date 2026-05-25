import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const LIVE_SCRIPT = resolve('scripts/check-docs.mjs')
const LOUD_BYPASS_SCRIPT = resolve('scripts/lib/loud-bypass.mjs')

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function run(cwd: string): { status: number; out: string } {
  // Strip ARBITER_SKIP_DOCS so tests are not affected by the pre-commit bypass env var.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ARBITER_SKIP_DOCS'),
  )
  const r = spawnSync('node', [join(cwd, 'scripts', 'check-docs.mjs')], {
    cwd,
    encoding: 'utf-8',
    env: cleanEnv,
  })
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function setupRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-docs-test-'))
  // bare "remote"
  const remote = join(dir, 'remote.git')
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
  const work = join(dir, 'work')
  mkdirSync(work, { recursive: true })
  execFileSync('git', ['init', '-b', 'main', work], { stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 't@x.dev'], { cwd: work, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: work, stdio: 'ignore' })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: work, stdio: 'ignore' })

  // baseline commit (docs + src) on main
  mkdirSync(join(work, 'src'), { recursive: true })
  mkdirSync(join(work, 'docs'), { recursive: true })
  mkdirSync(join(work, 'scripts', 'lib'), { recursive: true })
  writeFileSync(join(work, 'src', 'a.ts'), 'export const x = 1\n')
  writeFileSync(join(work, 'docs', 'README.md'), '# docs\n')
  // copy live scripts under test into the repo
  copyFileSync(LIVE_SCRIPT, join(work, 'scripts', 'check-docs.mjs'))
  copyFileSync(LOUD_BYPASS_SCRIPT, join(work, 'scripts', 'lib', 'loud-bypass.mjs'))
  git(['add', '.'], work)
  git(['commit', '-m', 'init'], work)
  git(['push', '-u', 'origin', 'main'], work)

  return { dir: work, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('scripts/check-docs.mjs — rebased-aware + [skip-docs] (#356)', () => {
  it('exits 0 when no code changes vs base', () => {
    const { dir, cleanup } = setupRepo()
    try {
      git(['checkout', '-b', 'feature'], dir)
      writeFileSync(join(dir, 'docs', 'NEW.md'), '# new\n')
      git(['add', '.'], dir)
      git(['commit', '-m', 'docs-only change'], dir)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when code changes without docs', () => {
    const { dir, cleanup } = setupRepo()
    try {
      git(['checkout', '-b', 'feature'], dir)
      writeFileSync(join(dir, 'src', 'b.ts'), 'export const y = 2\n')
      git(['add', '.'], dir)
      git(['commit', '-m', 'add feature'], dir)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.out).toMatch(/docs|documentation/i)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when code changes have a [skip-docs] commit tag', () => {
    const { dir, cleanup } = setupRepo()
    try {
      git(['checkout', '-b', 'feature'], dir)
      writeFileSync(join(dir, 'src', 'b.ts'), 'export const y = 2\n')
      git(['add', '.'], dir)
      git(['commit', '-m', 'refactor: tidy [skip-docs]'], dir)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('uses git merge-base so a rebased branch sees only its own diff', () => {
    const { dir, cleanup } = setupRepo()
    try {
      // Add an unrelated change to main AFTER branching, then rebase feature on top.
      git(['checkout', '-b', 'feature'], dir)
      writeFileSync(join(dir, 'src', 'b.ts'), 'export const y = 2\n')
      writeFileSync(join(dir, 'docs', 'B.md'), '# b\n')
      git(['add', '.'], dir)
      git(['commit', '-m', 'feature with docs'], dir)

      git(['checkout', 'main'], dir)
      writeFileSync(join(dir, 'src', 'c.ts'), 'export const z = 3\n')
      git(['add', '.'], dir)
      git(['commit', '-m', 'main: add c.ts without docs (unrelated)'], dir)
      git(['push', 'origin', 'main'], dir)

      git(['checkout', 'feature'], dir)
      git(['rebase', 'main'], dir)

      // Feature branch alone has docs alongside its src change → must pass
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
