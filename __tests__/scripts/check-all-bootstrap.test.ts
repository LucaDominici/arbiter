// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATE_MUTEX_HELD_ENV, gateLockPathFor } from '../../scripts/lib/gate-mutex.mjs'

import { writeDistManifest } from '../../scripts/lib/dist-staleness.mjs'

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
    if (level === 'L1' || level === 'preflight') {
      mkdirSync(join(dir, 'dist'))
      writeFileSync(join(dir, 'dist', 'cli.js'), '')
      writeDistManifest(dir)
      if (buildMode === 'missing-dist') rmSync(join(dir, 'dist'), { recursive: true })
      if (buildMode === 'missing-manifest') rmSync(join(dir, 'dist/.src-manifest.json'))
      if (buildMode === 'corrupt-dist') writeFileSync(join(dir, 'dist/.src-manifest.json'), '{')
      if (buildMode === 'stale-dist') {
        mkdirSync(join(dir, 'src/generators'), { recursive: true })
        writeFileSync(join(dir, 'src/generators/changed.ts'), 'export const changed = true')
      }
    }
    const preload = join(dir, 'tools.mjs')
    writeFileSync(
      preload,
      `import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
cp.spawnSync = (cmd, args) => {
  appendFileSync('calls.jsonl', JSON.stringify([cmd, ...args]) + '\\n')
  if (args.includes(process.env.BOOTSTRAP_TEST_MODE))
    return { status: 1, stdout: '', stderr: 'FIXTURE-CONTRACT-DIAGNOSTIC' }
  if (args.includes('scripts/check-tdd-evidence.mjs') && process.env.BOOTSTRAP_TEST_MODE === 'tdd-skip')
    return { status: 0, stdout: '[SKIP] fixture provenance unavailable', stderr: '' }
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
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ hasPublicApi: false }))
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
    if (extraEnv.BOOTSTRAP_DIRTY === '1') writeFileSync(join(dir, 'dirty.txt'), 'dirty\n')
    if (extraEnv.BOOTSTRAP_DOCS_CHANGE === 'ref-only')
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
    if (extraEnv.BOOTSTRAP_DOCS_CHANGE === '1') {
      // A comparable origin/main plus an untracked page under docs/ = a docs-surface change.
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'page.md'), '# page\n')
    }
    const env = {
      ...process.env,
      CI: '',
      GITHUB_ACTIONS: '',
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
    const calls = (
      existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf-8') : ''
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
    return {
      ...result,
      elapsedMs: Date.now() - startedAt,
      calls,
      artifact: existsSync(join(dir, '.arbiter/gate/local-result.json'))
        ? JSON.parse(readFileSync(join(dir, '.arbiter/gate/local-result.json'), 'utf-8'))
        : null,
      marker: existsSync(join(dir, '.arbiter/gate-pass.json')),
      receipt: existsSync(join(dir, '.arbiter/gate-pass.json'))
        ? JSON.parse(readFileSync(join(dir, '.arbiter/gate-pass.json'), 'utf-8'))
        : null,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim(),
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
      expect(result.calls.slice(0, 4)).toEqual([
        ['node', 'scripts/check-tdd-evidence.mjs'],
        ['node', 'scripts/check-evidence-bundle.mjs'],
        ['node', 'scripts/check-review-completion.mjs'],
        ['npm', 'run', 'build'],
      ])
      expect(result.calls.filter((call) => call.join(' ') === 'npm run build')).toHaveLength(1)
      expect(result.calls.some((call) => call.includes('scripts/build-kit.mjs'))).toBe(false)
      expect(result.calls.filter((call) => call[0] === 'npm' && call[1] === 'test')).toEqual([
        ['npm', 'test', '--', '--coverage'],
      ])
      expect(result.artifact.gates[3]).toMatchObject({ name: 'build', status: 'PASS' })
      expect(result.marker).toBe(true)
      expect(result.receipt).toMatchObject({ head_sha: result.head, start_head_sha: result.head })
      const gateNames = result.artifact.gates.map((gate: { name: string }) => gate.name)
      expect(gateNames).toEqual(
        expect.arrayContaining([
          'coverage ratchet (#1483)',
          'debt ratchet',
          'integration suite (INV-25)',
          'BDD suite (INV-25)',
          'doc-set presence',
        ]),
      )
      expect(new Set(gateNames).size).toBe(gateNames.length)
    },
  )

  it.each(['fail', 'skip'])('stops on a %s build and emits failed evidence', (mode) => {
    const result = runGate('L2', mode)
    expect(result.status).toBe(1)
    expect(result.calls.at(-1)).toEqual(['npm', 'run', 'build'])
    expect(result.calls).toHaveLength(4)
    expect(result.artifact.pass).toBe(false)
    expect(result.artifact.gates.slice(3)).toEqual([
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
    expect(
      failFast.artifact.gates.filter((gate: { status: string }) => gate.status === 'PASS'),
    ).toEqual([expect.objectContaining({ name: 'dist freshness prerequisite' })])
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
    const ci = runGate('L1', 'first-hard-fail', ['--fail-fast'], {
      CI: '1',
      GITHUB_ACTIONS: '1',
    })
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

describe('cheap gate prerequisites', () => {
  it.each([
    'scripts/check-tdd-evidence.mjs',
    'scripts/check-evidence-bundle.mjs',
    'scripts/check-review-completion.mjs',
    'tdd-skip',
  ])('blocks build and suites when %s fails or skips (AC-1)', (mode) => {
    const result = runGate('L2', mode)
    expect(result.status).toBe(1)
    expect(
      result.calls.every(
        (call) =>
          call[0] === 'node' &&
          [
            'scripts/check-tdd-evidence.mjs',
            'scripts/check-evidence-bundle.mjs',
            'scripts/check-review-completion.mjs',
          ].includes(call[1]),
      ),
    ).toBe(true)
    expect(result.artifact.pass).toBe(false)
    expect(result.marker).toBe(false)
    expect(result.stdout).toContain('=== Summary ===')
  })

  it.each(['missing-dist', 'missing-manifest', 'stale-dist', 'corrupt-dist'])(
    'classifies %s as a prerequisite error before any L1 child (AC-2)',
    (mode) => {
      const result = runGate('L1', mode)
      expect(result.status).toBe(2)
      expect(result.calls).toEqual([])
      expect(result.artifact.pass).toBe(false)
      expect(result.artifact.gates).toEqual([
        expect.objectContaining({ name: 'dist freshness prerequisite', status: 'FAIL' }),
      ])
      expect(result.stderr).toContain('prerequisite')
      expect(result.stderr).toContain('npm run build')
      expect(result.marker).toBe(false)
    },
  )
})

describe('result-first preflight (#2724)', () => {
  it.each([
    'prettier',
    'scripts/pii-scan.mjs',
    'scripts/check-docs.mjs',
    'scripts/check-agent-dispatch.mjs',
    'scripts/check-feature-matrix.mjs',
  ])('collects cheap diagnostics and blocks costly suites on %s failure', (failure) => {
    const result = runGate('L2', failure)
    expect(result.status).toBe(1)
    expect(
      result.calls.some((call) => call.includes('scripts/check-kernel-plugin-parity.mjs')),
    ).toBe(true)
    expect(result.calls.some((call) => call.includes('test') || call.includes('vitest'))).toBe(
      false,
    )
    expect(result.artifact.pass).toBe(false)
    expect(result.marker).toBe(false)
  })

  it.each([
    ['pass', {}, 0],
    ['scripts/pii-scan.mjs', {}, 1],
    ['pass', { BOOTSTRAP_DIRTY: '1' }, 0],
    ['pass', { BOOTSTRAP_DOCS_CHANGE: '1' }, 0],
    ['pass', { BOOTSTRAP_DOCS_CHANGE: 'ref-only' }, 0],
  ] as const)('keeps the preflight roster fixed for %s with %o', (mode, extraEnv, status) => {
    const result = runGate('preflight', mode, [], extraEnv)

    expect(result.status, result.stderr).toBe(status)
    expect(result.calls).toEqual([
      ['node', 'scripts/pii-scan.mjs'],
      ['node', 'scripts/check-secret-scan.mjs'],
      ['node', 'scripts/check-no-tracked-artifacts.mjs'],
    ])
    expect(result.artifact).toBeNull()
    expect(result.marker).toBe(false)
    expect(result.stdout).toContain('PREFLIGHT')
  })

  it.each([
    ['codex self-parity', 'scripts/check-codex-self-parity.mjs', ['node']],
    ['fail-closed audit', 'scripts/check-fail-closed-audit.mjs', ['node']],
    ['tdd-evidence', 'scripts/check-tdd-evidence.mjs', ['node']],
    ['docs', 'scripts/check-docs.mjs', ['node']],
    ['docs build', 'docs:build:verify', ['npm', 'run']],
  ] as const)('leaves %s to full qualification', (_name, failure, prefix) => {
    const preflight = runGate('preflight', failure)
    const qualification = runGate('L2', failure)

    expect(preflight.status, preflight.stderr).toBe(0)
    expect(preflight.calls.some((call) => call.includes(failure))).toBe(false)
    expect(qualification.status, qualification.stderr).toBe(1)
    expect(qualification.calls).toContainEqual([...prefix, failure])
  })

  it('does not turn absent coverage from a failed run into a second ratchet defect', () => {
    const result = runGate('L2', '--coverage')
    expect(result.status).toBe(1)
    expect(result.calls.some((call) => call.includes('scripts/check-coverage-ratchet.mjs'))).toBe(
      false,
    )
    expect(result.artifact.gates).toContainEqual(
      expect.objectContaining({ name: 'coverage ratchet (#1483)', status: 'SKIP' }),
    )
    expect(result.stdout).toContain('NO DATA')
  })
})
