// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-touched-vs-manifest.mjs (E7 #1943, M6 read-set).
 * Uses a real git repo fixture so `git diff --name-only` is exercised honestly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-touched-vs-manifest.mjs', import.meta.url).pathname

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'ignore'], timeout: 8000 })
}

function run(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 10000, cwd })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-touched-vs-manifest.mjs', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'touched-'))
    sh('git init -q -b main', repo)
    sh('git config user.email t@t', repo)
    sh('git config user.name t', repo)
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2\n')
    sh('git add -A', repo)
    sh('git commit -qm base', repo)
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('fails when the plan has no matching group section', () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: other\nFiles: src/a.ts\n')
    const r = run(['--plan', plan, '--group', 'G1', '--base', 'HEAD', '--repo-root', repo], repo)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/no .*Group: G1.* section/i)
  })

  it('passes when touched files ⊆ declared write set', () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts, src/b.ts\nRead-set: src/a.ts\n')
    // branch edits only src/a.ts
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    sh('git add -A && git commit -qm edit', repo)
    const r = run(
      [
        '--plan',
        plan,
        '--group',
        'G1',
        '--base',
        'main',
        '--branch',
        'feature',
        '--repo-root',
        repo,
      ],
      repo,
    )
    expect(r.exitCode).toBe(0)
  })

  it('fails when a touched file is outside the declared write set', () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts\nRead-set: src/a.ts\n')
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 99\n') // outside manifest
    sh('git add -A && git commit -qm edit', repo)
    const r = run(
      [
        '--plan',
        plan,
        '--group',
        'G1',
        '--base',
        'main',
        '--branch',
        'feature',
        '--repo-root',
        repo,
      ],
      repo,
    )
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/src\/b\.ts/)
    expect(r.stdout).toMatch(/ADR-103/i)
  })

  it('emits advisory (exit 0) when Read-set row is absent', () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts\n')
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    sh('git add -A && git commit -qm edit', repo)
    const r = run(
      [
        '--plan',
        plan,
        '--group',
        'G1',
        '--base',
        'main',
        '--branch',
        'feature',
        '--repo-root',
        repo,
      ],
      repo,
    )
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toMatch(/advisory/i)
  })
})
