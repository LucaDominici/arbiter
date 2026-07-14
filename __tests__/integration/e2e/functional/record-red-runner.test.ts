// SPDX-License-Identifier: Apache-2.0
// #1951 — `arbiter task record-red` must capture an authentic RED phase for
// each stack (TS/Go/Python), selecting the runner from the project language
// (or honouring an explicit --test-command), with no shell interpolation. These
// integration tests materialize a real failing test per stack and drive the
// real `runTaskRecordRed` (no runCli mock). Runs under the nightly
// generated-gate-e2e job (VITEST_L2=1) where the toolchains are installed;
// SKIPs with a reason where a toolchain is absent.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

import { runTaskRecordRed } from '../../../../src/commands/task-record-red.js'
import { runCli } from '../../../../src/utils/run-cli.js'

const L2 = process.env.VITEST_L2 === '1'

const ARBITER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const VITEST_BIN = join(ARBITER_ROOT, 'node_modules', '.bin', 'vitest')

function hasBinary(bin: string): boolean {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

function initGitRepo(dir: string): void {
  runCli('git', ['init', '-q'], { cwd: dir, timeoutMs: 5000 })
  runCli('git', ['config', 'user.email', 't@t'], { cwd: dir, timeoutMs: 5000 })
  runCli('git', ['config', 'user.name', 't'], { cwd: dir, timeoutMs: 5000 })
}

function seedTaskId(dir: string, taskId: string): void {
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', '.task-id'), `${taskId}\n`, 'utf-8')
}

function evidencePath(dir: string, taskId: string): string {
  return join(dir, '.arbiter', 'evidence', 'tdd', `${taskId}.json`)
}

function readEvidence(dir: string, taskId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(evidencePath(dir, taskId), 'utf-8'))
}

describe.skipIf(!L2)('record-red runner selection (#1951)', () => {
  it.skipIf(!hasBinary('node'))(
    'TypeScript: explicit --test-command records a real vitest RED (#1951)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'rr-ts-'))
      try {
        initGitRepo(dir)
        seedTaskId(dir, '#1')
        writeFileSync(
          join(dir, 'arbiter.json'),
          JSON.stringify({ language: 'typescript' }),
          'utf-8',
        )
        writeFileSync(
          join(dir, 'fail.test.ts'),
          "import { describe, it, expect } from 'vitest'\n" +
            "describe('red', () => { it('fails', () => { expect(1).toBe(2) }) })\n",
        )
        // Plain vitest config so the temp project resolves without node_modules
        // (vitest is run from the arbiter repo's binary with --root here).
        writeFileSync(
          join(dir, 'vitest.config.mjs'),
          "export default { test: { include: ['*.test.ts'] } }\n",
        )
        runCli('git', ['add', '-A'], { cwd: dir, timeoutMs: 5000 })
        runCli('git', ['commit', '-q', '-m', 'red'], { cwd: dir, timeoutMs: 5000 })
        const result = runTaskRecordRed({
          testPath: 'fail.test.ts',
          dir,
          testCmd: [VITEST_BIN, 'run', '--root', dir],
          timeoutMs: 120_000,
        })
        expect(result.ok, `expected RED, got: ${result.ok ? '' : result.reason}`).toBe(true)
        const ev = readEvidence(dir, '#1')
        expect(String(ev.observed_failure)).toMatch(/FAIL/i)
        expect(ev.test_command).toEqual([VITEST_BIN, 'run', '--root', dir])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    180_000,
  )

  it.skipIf(!hasBinary('go'))(
    'Go: auto-selects `go test <pkg-dir>` and records a real RED (#1951)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'rr-go-'))
      try {
        initGitRepo(dir)
        seedTaskId(dir, '#2')
        runCli('go', ['mod', 'init', 'example.com/rr'], { cwd: dir, timeoutMs: 10000 })
        writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'go' }), 'utf-8')
        mkdirSync(join(dir, 'pkg'), { recursive: true })
        writeFileSync(join(dir, 'pkg', 'foo.go'), 'package pkg\n\nfunc Foo() int { return 1 }\n')
        writeFileSync(
          join(dir, 'pkg', 'foo_test.go'),
          'package pkg\n\nimport "testing"\n\nfunc TestFooRed(t *testing.T) {\n\tif Foo() != 2 {\n\t\tt.Fatalf("want 2 got %d", Foo())\n\t}\n}\n',
        )
        runCli('git', ['add', '-A'], { cwd: dir, timeoutMs: 5000 })
        runCli('git', ['commit', '-q', '-m', 'red'], { cwd: dir, timeoutMs: 5000 })
        const result = runTaskRecordRed({ testPath: 'pkg/foo_test.go', dir, timeoutMs: 60_000 })
        expect(result.ok, `expected RED, got: ${result.ok ? '' : result.reason}`).toBe(true)
        const ev = readEvidence(dir, '#2')
        expect(String(ev.observed_failure)).toMatch(/--- FAIL/)
        expect(ev.test_command).toEqual(['go', 'test', './pkg'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000,
  )

  it.skipIf(!hasBinary('pytest'))(
    'Python: auto-selects `pytest <path>` and records a real RED (#1951)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'rr-py-'))
      try {
        initGitRepo(dir)
        seedTaskId(dir, '#3')
        writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ language: 'python' }), 'utf-8')
        writeFileSync(
          join(dir, 'test_red.py'),
          'def test_red_failure():\n    assert 1 == 2, "intentional RED"\n',
        )
        runCli('git', ['add', '-A'], { cwd: dir, timeoutMs: 5000 })
        runCli('git', ['commit', '-q', '-m', 'red'], { cwd: dir, timeoutMs: 5000 })
        const result = runTaskRecordRed({ testPath: 'test_red.py', dir, timeoutMs: 60_000 })
        expect(result.ok, `expected RED, got: ${result.ok ? '' : result.reason}`).toBe(true)
        const ev = readEvidence(dir, '#3')
        expect(String(ev.observed_failure)).toMatch(/FAILURES/)
        expect(ev.test_command).toEqual(['pytest', 'test_red.py'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
