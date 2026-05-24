// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1039): spawn the real arbiter CLI binary and assert
// observable output/exit-code invariants. Tests the full composed pipeline,
// not just individual functions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-behavioral-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
}

// ---------------------------------------------------------------------------
// Top-level CLI surface
// ---------------------------------------------------------------------------

describe('arbiter CLI — top-level surface', () => {
  it('--version exits 0 and prints semver', () => {
    const { status, stdout } = spawn(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('--help exits 0 and prints "Usage: arbiter"', () => {
    const { status, stdout } = spawn(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Usage: arbiter')
  })

  it('unknown command exits non-zero', () => {
    const { status } = spawn(['no-such-command-xyzzy'])
    expect(status).not.toBe(0)
  })

  it('init --help exits 0 and mentions --level', () => {
    const { status, stdout } = spawn(['init', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('--level')
  })
})

// ---------------------------------------------------------------------------
// arbiter init — end-to-end spawn against a real tmpdir project
// ---------------------------------------------------------------------------

describe('arbiter init — end-to-end (behavioral)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTmpDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-pkg', version: '1.0.0' }))
    initGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 and creates arbiter.json', () => {
    const { status, stdout, stderr } = spawn(
      ['init', '--yes', '--level', 'L1', '--tools', 'claude', '--no-verify'],
      dir,
    )
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
  }, 30_000)

  it('exits 0 and reports files created', () => {
    const { status, stdout, stderr } = spawn(
      ['init', '--yes', '--level', 'L2', '--tools', 'claude', '--no-verify'],
      dir,
    )
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout).toMatch(/files created/)
  }, 30_000)

  it('--dry-run exits 0 and does NOT create arbiter.json', () => {
    const { status, stdout, stderr } = spawn(
      ['init', '--yes', '--level', 'L1', '--tools', 'claude', '--dry-run', '--no-verify'],
      dir,
    )
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  }, 30_000)

  it('update exits non-zero with helpful message when no arbiter.json present', () => {
    // update requires an existing arbiter.json; clean dir must produce an error
    const { status, stdout } = spawn(['update'], dir)
    expect(status).not.toBe(0)
    expect(stdout).toContain('arbiter init')
  })
})
