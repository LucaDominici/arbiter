// SPDX-License-Identifier: Apache-2.0
// #1957 — reproduces a real false-green found in a downstream project:
// evidence named a specific failing test whose `test_commit_sha` predated
// that test's own existence. The test *file* existed at that commit (with an unrelated,
// already-passing test in it), but the specific test named in the evidence
// did not — it was added in the same commit as the production fix.
//
// The five pre-#1957 checks (evidence-file, task-id-match, failure-signature,
// sha-on-branch, test-path-in-commit) all pass for such evidence: none of
// them re-run anything, they only confirm the *file* existed and that some
// failure text is present in a self-reported log. Only re-executing the
// recorded `test_command` against the recorded `test_commit_sha` from real
// source can catch this. This is a real, unmocked git repo + real vitest
// subprocess — no mocking of runVerifyTdd or its dependencies.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { runVerifyTdd } from '../../../src/commands/verify-tdd.js'

const ARBITER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function commit(dir: string, message: string): string {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

describe('TDD red-execution gap (#1957)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'tdd-red-gap-'))
    dirs.push(d)
    git(d, ['init', '-q'])
    git(d, ['config', 'user.email', 't@t'])
    git(d, ['config', 'user.name', 't'])
    // Resolve vitest without a per-fixture npm install (mirrors
    // __tests__/integration/e2e/functional/record-red-runner.test.ts).
    symlinkSync(join(ARBITER_ROOT, 'node_modules'), join(d, 'node_modules'))
    writeFileSync(
      join(d, 'vitest.config.mjs'),
      "export default { test: { include: ['*.test.ts'] } }\n",
    )
    return d
  }

  it('rejects evidence naming a test that did not exist yet at test_commit_sha (false-green)', () => {
    const dir = tmpRepo()

    // Commit A: buggy production code + a test FILE that exists, but only
    // covers unrelated (already-passing) behaviour — the specific test this
    // evidence will claim as "red" here is not in this commit at all.
    writeFileSync(
      join(dir, 'math.ts'),
      'export function add(a: number, b: number): number {\n  return a - b // bug\n}\n',
    )
    writeFileSync(
      join(dir, 'math.test.ts'),
      "import { describe, it, expect } from 'vitest'\n" +
        "describe('sanity', () => { it('passes', () => { expect(1).toBe(1) }) })\n",
    )
    const shaBeforeFix = commit(dir, 'chore: buggy add() + unrelated test')

    // Commit B: fix lands together with the new covering test — same commit,
    // exactly the downstream-project pattern this reproduces.
    writeFileSync(
      join(dir, 'math.ts'),
      'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    )
    writeFileSync(
      join(dir, 'math.test.ts'),
      "import { describe, it, expect } from 'vitest'\n" +
        "import { add } from './math.js'\n" +
        "describe('sanity', () => { it('passes', () => { expect(1).toBe(1) }) })\n" +
        "describe('add', () => { it('adds correctly', () => { expect(add(2, 3)).toBe(5) }) })\n",
    )
    commit(dir, 'feat(#9001): fix add() + cover it')

    // Fabricated evidence: claims the "add correctly" test was red at
    // shaBeforeFix — structurally impossible, since that test does not
    // exist in that commit's tree at all.
    const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(
      join(evDir, '#9001.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#9001',
        test_path: 'math.test.ts',
        test_commit_sha: shaBeforeFix,
        test_run_log:
          'FAIL math.test.ts\n✗ add > adds correctly\nAssertionError: expected -1 to be 5',
        observed_failure: 'FAIL math.test.ts',
        recorded_at: new Date().toISOString(),
        test_command: ['npx', 'vitest', 'run', 'math.test.ts'],
      }),
      'utf-8',
    )

    const result = runVerifyTdd({ taskId: '#9001', dir })

    expect(result.status, `expected FAIL, got PASS — false-green not caught`).toBe('FAIL')
    const reExecCheck = result.checks?.find((c) => c.name === 'red-execution')
    expect(reExecCheck?.pass).toBe(false)
  }, 60_000)
})
