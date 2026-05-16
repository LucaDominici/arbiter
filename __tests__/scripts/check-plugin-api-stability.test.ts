// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'check-plugin-api-stability.mjs')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-pluginapi-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 't@t'])
  git(dir, ['config', 'user.name', 't'])
  git(dir, ['checkout', '-q', '-b', 'main'])
  mkdirSync(join(dir, 'src', 'types'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'types', 'plugin.ts'),
    `export interface ArbiterPlugin {\n  name: string\n  apiVersion: '1'\n}\n`,
  )
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'seed'])
  git(dir, ['checkout', '-q', '-b', 'feature'])
  return dir
}

function runGate(cwd: string): { exit: number; stderr: string } {
  const res = spawnSync('node', [SCRIPT], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ARBITER_DIFF_BASE: 'main' },
  })
  return { exit: res.status ?? -1, stderr: res.stderr ?? '' }
}

describe('check-plugin-api-stability (#603)', () => {
  let dir: string
  beforeEach(() => {
    dir = initRepo()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('PASS when plugin.ts unchanged', () => {
    const r = runGate(dir)
    expect(r.exit).toBe(0)
  })

  it('FAIL when plugin.ts changed without apiVersion bump', () => {
    writeFileSync(
      join(dir, 'src', 'types', 'plugin.ts'),
      `export interface ArbiterPlugin {\n  name: string\n  apiVersion: '1'\n  newField: string\n}\n`,
    )
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'add newField without bump'])
    const r = runGate(dir)
    expect(r.exit).toBe(1)
    expect(r.stderr).toMatch(/apiVersion/i)
  })

  it('PASS when plugin.ts changed AND apiVersion bumped', () => {
    writeFileSync(
      join(dir, 'src', 'types', 'plugin.ts'),
      `export interface ArbiterPlugin {\n  name: string\n  apiVersion: '2'\n  newField: string\n}\n`,
    )
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'bump apiVersion to 2'])
    const r = runGate(dir)
    expect(r.exit).toBe(0)
  })

  it('skips with warning when base ref unresolvable', () => {
    const res = spawnSync('node', [SCRIPT], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, ARBITER_DIFF_BASE: 'no-such-ref-xyz' },
    })
    // Even with an invalid base, git diff fails and the script skips → exit 0
    expect(res.status).toBe(0)
  })
})
