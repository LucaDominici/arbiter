// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1039): spawn the real arbiter CLI binary and assert
// observable output/exit-code invariants. Tests the full composed pipeline,
// not just individual functions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
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

  // #1837 (F1): --version was hardcoded to '0.3.0' while package.json had already
  // moved to 0.4.0 — the two silently drifted. A permanent version-parity gate
  // lands in wave F2; this test is the regression guard until then.
  it('--version matches package.json version (regression guard for #1837)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'),
    ) as {
      version: string
    }
    const { status, stdout } = spawn(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe(pkg.version)
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

  // H1 (gold-doc-capability, Tranche 0) regression guard: `doc-set` was previously unregistered
  // (`error: unknown command 'doc-set'`), which meant the governed thin-runner
  // (scripts/check-doc-set.mjs.ejs → `npx arbiter doc-set`) could never resolve. This asserts the
  // command is actually wired into Commander, not just exported as a TS function.
  it('doc-set --help exits 0 and mentions --strict + --doc-profile', () => {
    const { status, stdout } = spawn(['doc-set', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('--strict')
    expect(stdout).toContain('--doc-profile')
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
