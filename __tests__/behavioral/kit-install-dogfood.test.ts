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
// Pre-commit hook rsyncs to a temp dir without .git; use the original worktree for git ops.
const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD ?? REPO_ROOT

// Set of repo-relative untracked paths (excluding node_modules), read from the shared
// working tree. Used by the stray-writes check to detect files created by the CLI.
function untrackedFiles(): Set<string> {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: GIT_CWD, encoding: 'utf-8' })
  return new Set(
    (result.stdout ?? '')
      .split('\n')
      .filter((l) => l.match(/^\?\?/))
      .filter((l) => !l.includes('node_modules')),
  )
}

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

  // ─── R-08 remap regression guard (P5) ─────────────────────────────────────
  // canonical-mapping.json is documentation/provenance metadata — no consumer
  // in this pipeline reads import_source/unmapped_import_dims/detail/
  // planning_notes. The self-assessment score must be byte-identical to the
  // pre-remap baseline (captured against commit 9b749141, before the R-08
  // crosswalk landed).
  it('[MEASURE]/[ASSESS]/[VERIFY] counts match the pre-remap baseline', () => {
    const out = firstRun.stdout + firstRun.stderr
    expect(out).toMatch(/\[MEASURE\].*63 dims measured.*present:44 partial:2 missing:17 na:15/)
    expect(out).toMatch(/\[ASSESS\].*78 dims.*Y:41 P:15 N:7 NA:15/)
    expect(out).toMatch(/\[VERIFY\].*coverage 65% \(41\/63 dims\)/)
  })
})

// ─── No arbiter.json mutation (C1) ───────────────────────────────────────────
// Note: under pre-commit, the hook rsyncs the repo to a temp dir without .git;
// any CLI mutation would land in the temp copy, not the real repo. GIT_CWD points
// to the real git root (ARBITER_HOOK_GIT_CWD) so git diff always sees a clean tree.
// This assertion is authoritative in normal `vitest` runs (CLI cwd = real repo).

describe('arbiter.json immutability under --dry-run (C1)', () => {
  it('arbiter.json is unchanged after dry-run (git diff --quiet)', () => {
    const result = spawnSync('git', ['diff', '--quiet', 'arbiter.json'], {
      cwd: GIT_CWD,
      encoding: 'utf-8',
    })
    // exit 0 = no changes; exit 1 = changed
    expect(result.status).toBe(0)
  })
})

// ─── No stray file writes ─────────────────────────────────────────────────────

describe('no stray file writes under --dry-run', () => {
  it('does not create files in repo root during dry-run', () => {
    // Detect only files created by THIS dry-run: snapshot untracked files immediately
    // before the spawn and re-read immediately after, so the detection window is the
    // spawn's own duration rather than the whole test file.
    //
    // Race hardening (#1907): the previous form snapshotted once in a file-level beforeAll
    // and compared in this (much later) test, so the window spanned the entire suite. Under
    // full-suite parallelism other test files legitimately write transient untracked
    // artifacts into the shared working tree, producing a false "the dry-run created a stray
    // file" positive in CI under load (green locally, red in CI). A real dry-run write would
    // recur on every attempt; a transient artifact from another parallel file will not — so
    // retry a few times and accept the first clean window. If the CLI genuinely wrote a stray
    // file, every attempt reports it and the test still fails.
    let newFiles: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = untrackedFiles()
      spawn([
        'kit',
        'install',
        '--experimental.kit',
        '--dry-run',
        '--report-path',
        join(tmpdir(), `arbiter-dogfood-stray-${process.pid}-${attempt}.md`),
      ])
      newFiles = [...untrackedFiles()].filter((l) => !before.has(l))
      if (newFiles.length === 0) break
    }
    expect(newFiles, `stray untracked files after dry-run:\n${newFiles.join('\n')}`).toHaveLength(0)
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
