// SPDX-License-Identifier: Apache-2.0
// #2908 round 2 — GREEN runs in the working tree, so `greenVerifiedSha` may only name HEAD when
// tracked files match it (F1), and the delivery record carries the `green=<sha7>` suffix (F3).
// Real git repo + real `node` re-execution of the recorded `test_command`; nothing is mocked.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskAdvance, runTaskReviewRound } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import { ArbiterError } from '../../src/utils/errors.js'
import { writeGatePassEvidence } from '../helpers.js'

const BRANCH = 'task/#2908-green-gate-head'
const SPEC = `if (require('fs').readFileSync(__dirname + '/impl.txt', 'utf8').trim() !== 'ok') {
  process.exit(1)
}
console.log('1 passed')
`
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()

function snapshot(cwd: string, message: string): string {
  sh(cwd, 'add', '-A')
  sh(cwd, 'commit', '-q', '-m', message)
  return sh(cwd, 'rev-parse', 'HEAD')
}

const logText = (cwd: string): string =>
  readFileSync(join(cwd, '.claude', '.task', 'log.md'), 'utf-8')

/** A repo at phase `green` with committed RED evidence and a passing HEAD. */
function greenRepo(spec = SPEC): { cwd: string; head: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'arbiter-2908-r2-'))
  roots.push(cwd)
  sh(cwd, 'init', '-q', '-b', BRANCH)
  sh(cwd, 'config', 'user.email', 'fixture@arbiter.dev')
  sh(cwd, 'config', 'user.name', 'Fixture')
  writeFileSync(join(cwd, '.gitignore'), '.claude/.task/\n.arbiter/\n')
  writeFileSync(join(cwd, 'spec.test.js'), spec)
  writeFileSync(join(cwd, 'impl.txt'), 'no')
  const red = snapshot(cwd, 'test: red')
  writeFileSync(join(cwd, 'impl.txt'), 'ok')
  const head = snapshot(cwd, 'fix: green')
  mkdirSync(join(cwd, '.arbiter', 'evidence', 'tdd'), { recursive: true })
  const blob = createHash('sha1')
    .update(`blob ${Buffer.byteLength(spec)}\0${spec}`)
    .digest('hex')
  writeFileSync(
    join(cwd, '.arbiter', 'evidence', 'tdd', '#2908.json'),
    JSON.stringify({
      $schemaVersion: 1,
      task_id: '#2908',
      test_path: 'spec.test.js',
      test_commit_sha: red,
      test_blob_sha: blob,
      test_run_log: 'FAIL spec.test.js',
      observed_failure: 'FAIL spec.test.js',
      recorded_at: '2026-09-26T00:00:00.000Z',
      test_command: ['node', 'spec.test.js'],
    }),
  )
  writeUnifiedState(cwd, { phase: 'green', taskId: '#2908', branch: BRANCH })
  return { cwd, head }
}

/** Uncommitted tracked edit that still passes GREEN: GREEN would verify content HEAD lacks. */
const dirtyButPassing = (cwd: string): void => writeFileSync(join(cwd, 'impl.txt'), 'ok\n\n')

describe('#2908 F1: greenVerifiedSha names HEAD only when tracked files are clean', () => {
  it('clean refactor entry records HEAD; the review log line carries green=<sha7>', () => {
    const { cwd, head } = greenRepo()
    runTaskAdvance({ to: 'refactor', dir: cwd })
    expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe(head)
    expect(logText(cwd)).toMatch(/green → refactor$/m)

    runTaskReviewRound({ dir: cwd, headSha: head })
    expect(logText(cwd)).toMatch(
      new RegExp(`review → round 1 at ${head.slice(0, 7)} green=${head.slice(0, 7)}$`, 'm'),
    )
  })

  it('dirty refactor entry runs GREEN, records no SHA, and says so in the log line', () => {
    const { cwd } = greenRepo()
    dirtyButPassing(cwd)
    runTaskAdvance({ to: 'refactor', dir: cwd })
    const state = readUnifiedState(cwd)
    expect(state).toBeDefined()
    expect(state!.phase).toBe('refactor')
    expect(state!.greenVerifiedSha).toBe('')
    expect(logText(cwd)).toMatch(
      /green → refactor \(GREEN ran on uncommitted changes; no green sha recorded\)$/m,
    )
  })

  it('complete on a dirty tree is a coded refusal to commit or stash, and phase stays close', () => {
    const { cwd } = greenRepo()
    runTaskAdvance({ to: 'refactor', dir: cwd })
    writeUnifiedState(cwd, { phase: 'close' })
    dirtyButPassing(cwd)
    let refusal: unknown
    try {
      runTaskAdvance({ to: 'complete', dir: cwd, readPrs: () => [{ number: 7, state: 'MERGED' }] })
    } catch (err) {
      refusal = err
    }
    expect(refusal).toBeInstanceOf(ArbiterError)
    expect((refusal as ArbiterError).code).toBe('E_GREEN_DIRTY_TREE')
    expect((refusal as ArbiterError).hint).toBe('commit or stash, then retry')
    expect(readUnifiedState(cwd)?.phase).toBe('close')
  })

  it('clean complete re-records HEAD and the MERGED log line carries green=<sha7>', () => {
    const { cwd, head } = greenRepo()
    runTaskAdvance({ to: 'refactor', dir: cwd })
    const flags = { contractTesting: false, mutationTesting: false, securityScanning: false }
    const thresholds = { lineCoverage: 80, branchCoverage: 70, mutationScore: 80 }
    const config = {
      version: '0.2',
      governanceLevel: 'L2',
      tools: ['claude'],
      permitGitHub: true,
      features: { ...flags, evidenceHarness: false, debtGates: true, suppressions: true },
      thresholds: { ...thresholds, cyclomaticComplexity: 15, methodLength: 65, maxParams: 7 },
    }
    // Untracked on purpose: the F1 clean check covers tracked files only.
    writeFileSync(join(cwd, 'arbiter.json'), JSON.stringify(config))
    writeGatePassEvidence(cwd, { taskId: '#2908' })
    writeUnifiedState(cwd, { phase: 'close', greenVerifiedSha: 'f'.repeat(40) })
    runTaskAdvance({ to: 'complete', dir: cwd, readPrs: () => [{ number: 7, state: 'MERGED' }] })
    expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe(head)
    expect(logText(cwd)).toMatch(
      new RegExp(`complete ← PR #7 MERGED green=${head.slice(0, 7)}$`, 'm'),
    )
  })
})

/** Passes on any `ok*` impl; on `ok snap` the test run itself rewrites the tracked snap.txt. */
const SPEC_REWRITE = `const fs = require('fs')
const impl = fs.readFileSync(__dirname + '/impl.txt', 'utf8').trim()
if (!impl.startsWith('ok')) process.exit(1)
if (impl === 'ok snap') fs.writeFileSync(__dirname + '/snap.txt', 'rewritten\\n')
console.log('1 passed')
`

/** Refactor entered cleanly at X (recorded), then Y committed whose GREEN run dirties snap.txt. */
function rewritingRepo(): { cwd: string; x: string; y: string } {
  const { cwd, head: x } = greenRepo(SPEC_REWRITE)
  runTaskAdvance({ to: 'refactor', dir: cwd })
  expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe(x)
  writeFileSync(join(cwd, 'snap.txt'), 'orig\n')
  writeFileSync(join(cwd, 'impl.txt'), 'ok snap')
  return { cwd, x, y: snapshot(cwd, 'fix: rewrites snap') }
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (err) {
    return err instanceof ArbiterError ? err.code : String(err)
  }
  return undefined
}

describe('#2908 F2: a GREEN run that rewrites a tracked file never leaves a stale green sha', () => {
  it('review freeze at Y is refused with E_GREEN_DIRTY_TREE and the X record is cleared', () => {
    const { cwd, y } = rewritingRepo()
    expect(codeOf(() => runTaskReviewRound({ dir: cwd, headSha: y }))).toBe('E_GREEN_DIRTY_TREE')
    expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe('')
    expect(logText(cwd)).not.toMatch(/review → round 1/)
  })

  it('complete at Y is refused with the same coded remedy and phase stays close', () => {
    const { cwd } = rewritingRepo()
    writeUnifiedState(cwd, { phase: 'close' })
    const complete = (): unknown =>
      runTaskAdvance({ to: 'complete', dir: cwd, readPrs: () => [{ number: 7, state: 'MERGED' }] })
    expect(codeOf(complete)).toBe('E_GREEN_DIRTY_TREE')
    expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe('')
    expect(readUnifiedState(cwd)?.phase).toBe('close')
  })

  it('refactor entry whose run dirties a tracked file clears a previous sha and logs the note', () => {
    const { cwd } = greenRepo(SPEC_REWRITE)
    writeFileSync(join(cwd, 'snap.txt'), 'orig\n')
    writeFileSync(join(cwd, 'impl.txt'), 'ok snap')
    snapshot(cwd, 'fix: rewrites snap')
    writeUnifiedState(cwd, { greenVerifiedSha: 'f'.repeat(40) })
    runTaskAdvance({ to: 'refactor', dir: cwd })
    expect(readUnifiedState(cwd)?.greenVerifiedSha).toBe('')
    expect(logText(cwd)).toMatch(/green → refactor \(GREEN ran on uncommitted changes;/m)
  })
})
