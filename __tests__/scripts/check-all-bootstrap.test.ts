// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATE_MUTEX_HELD_ENV, gateLockPathFor } from '../../scripts/lib/gate-mutex.mjs'

const SCRIPT = resolve('scripts/check-all.mjs')

/** Exercise the real orchestration and artifact writer; stub only child tools. */
function runGate(
  level: string,
  buildMode = 'pass',
  args: string[] = [],
  extraEnv: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-bootstrap-'))
  try {
    // L1's historical lightweight preparation assumes an existing compilation.
    if (level === 'L1') {
      mkdirSync(join(dir, 'dist'))
      writeFileSync(join(dir, 'dist', 'cli.js'), '')
    }
    const preload = join(dir, 'tools.mjs')
    writeFileSync(
      preload,
      `import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
cp.spawnSync = (cmd, args) => {
  appendFileSync('calls.jsonl', JSON.stringify([cmd, ...args]) + '\\n')
  const build = cmd === 'npm' && args.join(' ') === 'run build'
  const firstHard =
    process.env.BOOTSTRAP_TEST_MODE === 'first-hard-fail' &&
    (args.includes('scripts/build-kit.mjs') || args.includes('scripts/check-no-redacted-tokens.mjs'))
  if (firstHard)
    return { status: 1, stdout: '', stderr: 'FIXTURE-FIRST-HARD-DIAGNOSTIC' }
  if (process.env.BOOTSTRAP_TEST_MODE === 'first-hard-fail')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  if (build && process.env.BOOTSTRAP_TEST_MODE === 'fail')
    return { status: 1, stdout: '', stderr: 'fixture compiler failed' }
  if (build && process.env.BOOTSTRAP_TEST_MODE === 'skip')
    return { status: 0, stdout: '[SKIP] fixture build unavailable', stderr: '' }
  if (build) { mkdirSync('dist', { recursive: true }); writeFileSync('dist/cli.js', '') }
  if (args.includes('scripts/check-version-parity.mjs') && !existsSync('dist/cli.js'))
    return { status: 2, stdout: '', stderr: 'dist missing' }
  return { status: 0, stdout: '', stderr: '' }
}
syncBuiltinESMExports()
`,
    )
    writeFileSync(join(dir, '.gitignore'), 'dist/\ncalls.jsonl\n.arbiter/\n')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'test: bootstrap fixture',
      ],
      { cwd: dir },
    )
    const env = {
      ...process.env,
      ARBITER_SELECTIVE_GATE: '0',
      BOOTSTRAP_TEST_MODE: buildMode,
      [GATE_MUTEX_HELD_ENV]: gateLockPathFor(dir),
      ...extraEnv,
    }
    delete env.ARBITER_HOOK_GIT_CWD
    const startedAt = Date.now()
    const result = spawnSync(process.execPath, ['--import', preload, SCRIPT, level, ...args], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 15_000,
      env,
    })
    const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    return {
      ...result,
      elapsedMs: Date.now() - startedAt,
      calls,
      artifact: JSON.parse(readFileSync(join(dir, '.arbiter/gate/local-result.json'), 'utf-8')),
      marker: existsSync(join(dir, '.arbiter/gate-pass.json')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('native L2 build prerequisite', () => {
  it.each(['L2', 'L3', 'gate'])(
    'prepares %s once before checks, with one coverage run',
    (level) => {
      const result = runGate(level)
      expect(result.status, result.stderr).toBe(0)
      expect(result.calls[0]).toEqual(['npm', 'run', 'build'])
      expect(result.calls.filter((call) => call.join(' ') === 'npm run build')).toHaveLength(1)
      expect(result.calls.some((call) => call.includes('scripts/build-kit.mjs'))).toBe(false)
      expect(result.calls.filter((call) => call[0] === 'npm' && call[1] === 'test')).toEqual([
        ['npm', 'test', '--', '--coverage'],
      ])
      expect(result.artifact.gates[0]).toMatchObject({ name: 'build', status: 'PASS' })
      expect(result.marker).toBe(true)
    },
  )

  it.each(['fail', 'skip'])('stops on a %s build and emits failed evidence', (mode) => {
    const result = runGate('L2', mode)
    expect(result.status).toBe(1)
    expect(result.calls).toEqual([['npm', 'run', 'build']])
    expect(result.artifact.pass).toBe(false)
    expect(result.artifact.gates).toEqual([
      expect.objectContaining({ name: 'build', status: 'FAIL', pass: false }),
    ])
    expect(result.stdout).toContain('=== Summary ===')
    expect(result.stderr).toContain('build')
    expect(result.marker).toBe(false)
  })

  it('keeps L1 lightweight and compares the same static validation subset', () => {
    const l1 = runGate('L1')
    const l2 = runGate('L2')
    expect(l1.status, l1.stderr).toBe(0)
    expect(l1.calls[0]).toEqual(['node', 'scripts/build-kit.mjs'])
    expect(l1.calls.some((call) => call.join(' ') === 'npm run build')).toBe(false)
    expect(l1.calls.filter((call) => call[0] === 'npm' && call[1] === 'test')).toEqual([
      ['npm', 'test'],
    ])
    expect(l1.artifact.gates).toContainEqual(
      expect.objectContaining({ name: 'bypass ceremony (E4 #1949)', status: 'PASS' }),
    )
    expect(l1.artifact.parityGates).toEqual(l2.artifact.parityGates)
    expect(l1.artifact.parityContentHash).toBe(l2.artifact.parityContentHash)
  })

  it('short-circuits only local L1 after a hard failure, with visible skips and no marker (AC-1, AC-2, AC-4)', () => {
    const accumulating = runGate('L1', 'first-hard-fail')
    const failFast = runGate('L1', 'first-hard-fail', ['--fail-fast'])
    expect(accumulating.status).toBe(1)
    expect(failFast.status).toBe(1)
    expect(failFast.stderr).toContain('FIXTURE-FIRST-HARD-DIAGNOSTIC')
    expect(failFast.stdout).toContain('SKIP (fail-fast after prior hard failure')
    expect(failFast.stdout).not.toContain('PASS (')
    expect(failFast.calls).toEqual([['node', 'scripts/build-kit.mjs']])
    expect(accumulating.calls.length).toBeGreaterThan(failFast.calls.length)
    expect(failFast.marker).toBe(false)
    console.log(
      `[measure] first-hard-fail L1 process_count ${accumulating.calls.length} -> ${failFast.calls.length}; ` +
        `elapsed_ms ${accumulating.elapsedMs} -> ${failFast.elapsedMs}`,
    )
  })

  it('keeps all-green local fail-fast process selection identical to the default (AC-2)', () => {
    const normal = runGate('L1')
    const failFast = runGate('L1', 'pass', ['--fail-fast'])
    expect(normal.status, normal.stderr).toBe(0)
    expect(failFast.status, failFast.stderr).toBe(0)
    expect(failFast.calls).toEqual(normal.calls)
    expect(failFast.marker).toBe(true)
  })

  it('ignores fail-fast in L2 and CI lanes so later checks still launch (AC-2)', () => {
    const l2 = runGate('L2', 'first-hard-fail', ['--fail-fast'])
    const ci = runGate('L1', 'first-hard-fail', ['--fail-fast'], { CI: '1' })
    const explicitL2 = runGate('L1', 'first-hard-fail', ['check', '--level', 'L2', '--fail-fast'])
    for (const result of [l2, ci, explicitL2]) {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FIXTURE-FIRST-HARD-DIAGNOSTIC')
      expect(result.calls.length).toBeGreaterThan(2)
      expect(result.stdout).not.toContain('SKIP (fail-fast after prior hard failure')
      expect(result.marker).toBe(false)
    }
  })
})
