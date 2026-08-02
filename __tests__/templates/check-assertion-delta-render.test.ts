// SPDX-License-Identifier: Apache-2.0
// Render + discrimination tests (INV-48/CANON-04) for check-assertion-delta.mjs.ejs (#2161).
// Proves the template renders self-contained (no EJS tags, no lib import) and DISCRIMINATES:
// a diff that removes an assertion with none added FAILS (AC-1); one that rewrites/adds PASSES;
// a rising skip-marker count FAILS without a trailer and PASSES with one (AC-2); no test files
// touched is a vacuous PASS.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-assertion-delta.mjs.ejs', data)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf-8',
  })
}

/** A repo with a `base` branch carrying two assertions in one test file. */
function makeRepo(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'assertion-delta-render-'))
  const repo = join(dir, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(
    join(repo, 'src', 'a.test.ts'),
    "it('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n})\n",
  )
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'branch', 'base')
  return { dir, repo }
}

function runGuard(dir: string, repo: string, extraArgv: string[] = []) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check-assertion-delta.mjs'), render())
  const r = spawnSync(
    'node',
    [
      join(dir, 'scripts', 'check-assertion-delta.mjs'),
      '--repo-root',
      repo,
      '--range',
      'base..HEAD',
      ...extraArgv,
    ],
    { encoding: 'utf-8' },
  )
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

describe('check-assertion-delta.mjs.ejs render (#2161)', () => {
  it('renders as a self-contained, tag-free guard with no lib import', () => {
    const content = render()
    expect(content).toMatch(/^#!/)
    expect(content).toContain('Assertion-Delta-Override')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    expect(content).not.toContain("from './lib/")
  })

  it('AC-1: FAILS when an assertion is removed with none added', () => {
    const { dir, repo } = makeRepo()
    try {
      writeFileSync(join(repo, 'src', 'a.test.ts'), "it('x', () => {\n  expect(1).toBe(1)\n})\n")
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'test: drop an assertion')
      const r = runGuard(dir, repo)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/assertion\(s\) removed/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-1: PASSES when assertions are rewritten/added (net delta >= 0)', () => {
    const { dir, repo } = makeRepo()
    try {
      writeFileSync(
        join(repo, 'src', 'a.test.ts'),
        "it('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n  expect(3).toBe(3)\n})\n",
      )
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'test: strengthen')
      expect(runGuard(dir, repo).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2: FAILS when the skip-marker count rises without an override trailer', () => {
    const { dir, repo } = makeRepo()
    try {
      writeFileSync(
        join(repo, 'src', 'a.test.ts'),
        "it.skip('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n})\n",
      )
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'test: skip it for now')
      const r = runGuard(dir, repo)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/skip-marker count increased/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2: PASSES (overridden) when the tip commit carries the trailer', () => {
    const { dir, repo } = makeRepo()
    try {
      writeFileSync(
        join(repo, 'src', 'a.test.ts'),
        "it.skip('x', () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n})\n",
      )
      git(repo, 'add', '.')
      git(
        repo,
        'commit',
        '-q',
        '-m',
        'test: skip it for now\n\nAssertion-Delta-Override: flaky upstream, tracked in #1\n',
      )
      const r = runGuard(dir, repo)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/OVERRIDDEN/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('vacuous PASS when no test files are touched in range', () => {
    const { dir, repo } = makeRepo()
    try {
      writeFileSync(join(repo, 'README.md'), '# hello\n')
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'docs: add readme')
      expect(runGuard(dir, repo).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails OPEN (exit 0, SKIP) when the range cannot be resolved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assertion-delta-norange-'))
    const repo = join(dir, 'repo')
    mkdirSync(repo, { recursive: true })
    try {
      git(repo, 'init', '-q')
      writeFileSync(join(repo, 'README.md'), '# hello\n')
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'init')
      const r = runGuard(dir, repo)
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/could not be resolved/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
