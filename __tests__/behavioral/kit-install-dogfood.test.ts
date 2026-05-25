// SPDX-License-Identifier: Apache-2.0
// Behavioral test: arbiter kit install --dry-run dogfood against the arbiter repo itself.
// Verifies: real phase output (non-stub), no arbiter.json mutation, no stray file writes,
// deterministic audit report (byte-identical on second run).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath
const REPO_ROOT = resolve(import.meta.dirname, '../..')

function spawn(
  args: string[],
  cwd = REPO_ROOT,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

// ─── Phase output assertions ───────────────────────────────────────────────────

describe('arbiter kit install --dry-run (dogfood)', () => {
  let firstRun: { stdout: string; stderr: string; status: number }
  let reportPathA: string

  beforeAll(() => {
    reportPathA = join(tmpdir(), `arbiter-dogfood-audit-A-${process.pid}.md`)

    firstRun = spawn([
      'kit',
      'install',
      '--experimental.kit',
      '--dry-run',
      '--report-path',
      reportPathA,
    ])
  })

  it('exits 0', () => {
    expect(firstRun.status, `stdout: ${firstRun.stdout}\nstderr: ${firstRun.stderr}`).toBe(0)
  })

  it('emits [DETECT] phase with non-stub language detection', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[DETECT]')
    // Must not be a stub placeholder
    expect(out).not.toMatch(/\[DETECT\].*stub/i)
  })

  it('emits [MEASURE] phase with dim count > 0', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[MEASURE]')
    expect(out).toMatch(/\[MEASURE\].*\d+.*dim/i)
  })

  it('emits [SCAFFOLD] phase with generator output', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[SCAFFOLD]')
    expect(out).not.toMatch(/\[SCAFFOLD\].*stub/i)
  })

  it('emits [ASSESS] phase with coverage counts', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[ASSESS]')
    expect(out).toMatch(/present|partial|missing/i)
  })

  it('emits [PLAN] phase with wave assignments', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[PLAN]')
    expect(out).toMatch(/W0|W1|W2/)
  })

  it('emits [VERIFY] phase', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toContain('[VERIFY]')
  })
})

// ─── No arbiter.json mutation (C1) ───────────────────────────────────────────

describe('arbiter.json immutability under --dry-run (C1)', () => {
  it('arbiter.json is unchanged after dry-run (git diff --quiet)', () => {
    const result = spawnSync('git', ['diff', '--quiet', 'arbiter.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
    // exit 0 = no changes; exit 1 = changed
    expect(result.status).toBe(0)
  })
})

// ─── No stray file writes ─────────────────────────────────────────────────────

describe('no stray file writes under --dry-run', () => {
  it('does not create files in repo root during dry-run', () => {
    // Rely on git to detect untracked/modified files (excludes node_modules via .gitignore)
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
    const newFiles = (result.stdout ?? '')
      .split('\n')
      .filter((l) => l.match(/^\?\?/))
      .filter((l) => !l.includes('node_modules'))
    // Only the audit report we explicitly wrote to /tmp should exist
    expect(newFiles).toHaveLength(0)
  })
})

// ─── Determinism (byte-identical second run) ──────────────────────────────────

describe('audit report determinism', () => {
  it('report file written to --report-path', () => {
    const reportPathA = join(tmpdir(), `arbiter-dogfood-det-A-${process.pid}.md`)
    spawn(['kit', 'install', '--experimental.kit', '--dry-run', '--report-path', reportPathA])
    expect(existsSync(reportPathA)).toBe(true)
  })

  it('two consecutive dry-run calls produce byte-identical report', () => {
    const pathA = join(tmpdir(), `arbiter-dogfood-det-X-${process.pid}.md`)
    const pathB = join(tmpdir(), `arbiter-dogfood-det-Y-${process.pid}.md`)
    spawn(['kit', 'install', '--experimental.kit', '--dry-run', '--report-path', pathA])
    spawn(['kit', 'install', '--experimental.kit', '--dry-run', '--report-path', pathB])

    const contentA = readFileSync(pathA, 'utf-8')
    const contentB = readFileSync(pathB, 'utf-8')
    expect(contentA).toBe(contentB)
  })
})
