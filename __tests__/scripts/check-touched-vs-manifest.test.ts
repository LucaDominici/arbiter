// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-touched-vs-manifest.mjs (E7 #1943, M6 read-set).
 * Uses a real git repo fixture so `git diff --name-only` is exercised honestly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SCRIPT = new URL('../../scripts/check-touched-vs-manifest.mjs', import.meta.url).pathname
const TEMPLATE = new URL(
  '../../src/templates/scripts/check-touched-vs-manifest.mjs.ejs',
  import.meta.url,
).pathname
const SCRIPT_URL = pathToFileURL(SCRIPT).href
let scriptInvocation = 0

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'ignore'], timeout: 8000 })
}

async function run(
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const originalCwd = process.cwd()
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalStdout = process.stdout.write
  const originalStderr = process.stderr.write
  let exitCode = 0
  let stdout = ''
  let stderr = ''
  process.argv = [process.execPath, SCRIPT, ...args]
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    return undefined as never
  }) as typeof process.exit
  process.stdout.write = ((chunk) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    process.chdir(cwd)
    await import(`${SCRIPT_URL}?test-run=${++scriptInvocation}`)
  } finally {
    process.chdir(originalCwd)
    process.argv = originalArgv
    process.exit = originalExit
    process.stdout.write = originalStdout
    process.stderr.write = originalStderr
  }
  return { exitCode, stdout, stderr }
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

  it('#2379 — does not claim cross-group disjointness is checked elsewhere', () => {
    for (const path of [SCRIPT, TEMPLATE]) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toMatch(/cross-group disjointness is established elsewhere/i)
      expect(source).toMatch(/cross-group disjointness .* not computed/i)
    }
  })

  it('fails when the plan has no matching group section', async () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: other\nFiles: src/a.ts\n')
    const r = await run(
      ['--plan', plan, '--group', 'G1', '--base', 'HEAD', '--repo-root', repo],
      repo,
    )
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/no .*Group: G1.* section/i)
  })

  it('passes when touched files ⊆ declared write set', async () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts, src/b.ts\nRead-set: src/a.ts\n')
    // branch edits only src/a.ts
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    sh('git add -A && git commit -qm edit', repo)
    const r = await run(
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

  it('#2379 — reports only the single-group write-set violation it actually checks', async () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts\nRead-set: src/a.ts\n')
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 99\n') // outside manifest
    sh('git add -A && git commit -qm edit', repo)
    const r = await run(
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
    expect(r.stdout).toMatch(/violated the declared write-set contract for group "G1"/i)
    expect(r.stdout).toMatch(/does not prove cross-group pairwise disjointness/i)
    expect(r.stdout).not.toMatch(/voided ADR-103 disjointness assumption/i)
  })

  it('emits advisory (exit 0) when Read-set row is absent', async () => {
    const planDir = mkdtempSync(join(tmpdir(), 'plan-'))
    const plan = join(planDir, 'plan.md')
    writeFileSync(plan, '## Group: G1\nFiles: src/a.ts\n')
    sh('git checkout -qb feature', repo)
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 99\n')
    sh('git add -A && git commit -qm edit', repo)
    const r = await run(
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
