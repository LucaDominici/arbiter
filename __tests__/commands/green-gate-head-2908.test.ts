// SPDX-License-Identifier: Apache-2.0
// #2908 — the GREEN execution gate runs only once, when the lifecycle enters `refactor`
// (`checkGreenExecutionGate` at task.ts, its sole caller), and records no SHA for that pass.
// `--review-round` (`assertReviewSubjectFrozen`) and the `complete` gate never re-run it, so a
// writer can enter `refactor` at commit X, commit a change to the pinned test at Y, and freeze
// or land Y with GREEN never replayed there. This is a real (unmocked) git repo + real `node`
// subprocess re-execution of the recorded `test_command` — no mocking of `verifyGreenExecution`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskAdvance, runTaskReviewRound } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function blobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex')
}

function commit(dir: string, message: string): string {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-gate-head-'))
  dirs.push(dir)
  git(dir, ['init', '-q', '-b', 'task/#2908-green-gate-head'])
  git(dir, ['config', 'user.email', 'fixture@arbiter.dev'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
  return dir
}

// The pinned test itself is executed directly as `test_command` (`node review.test.ts`); its own
// content never changes between the RED commit and refactor entry — only `impl.txt` (the
// production code under test) does, matching real TDD. So GREEN at refactor entry takes the
// blob-unchanged fast path (`pinned.redBlob === pinned.headBlob`) and needs no worktree replay.
const PINNED_TEST = `const fs = require('fs')
const ok = fs.readFileSync(__dirname + '/impl.txt', 'utf8').trim() === 'fixed'
if (!ok) { console.error('FAIL'); process.exit(1) }
console.log('1 passed')
`
const BROKEN_TEST = 'process.exit(1)\n'

/** Seeds a task through green → refactor with a real (unmocked) GREEN pass at commit X. */
function seedThroughRefactor(dir: string): { redSha: string; x: string } {
  writeFileSync(join(dir, 'review.test.ts'), PINNED_TEST)
  writeFileSync(join(dir, 'impl.txt'), 'broken')
  const redSha = commit(dir, 'test: seed failing pinned test')
  writeFileSync(join(dir, 'impl.txt'), 'fixed')
  const x = commit(dir, 'fix: make the pinned test pass')

  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(
    join(evDir, '#2908.json'),
    JSON.stringify({
      $schemaVersion: 1,
      task_id: '#2908',
      test_path: 'review.test.ts',
      test_commit_sha: redSha,
      test_blob_sha: blobSha(PINNED_TEST),
      test_run_log: 'FAIL review.test.ts\n✗ 1 test failed',
      observed_failure: 'FAIL review.test.ts',
      recorded_at: '2026-09-26T00:00:00.000Z',
      test_command: ['node', 'review.test.ts'],
    }),
  )
  writeUnifiedState(dir, { phase: 'green', taskId: '#2908' })
  runTaskAdvance({ to: 'refactor', dir })
  return { redSha, x }
}

describe('#2908 GREEN execution gate is re-run at the reviewed/landed head', () => {
  it('AC-2: the GREEN pass at refactor entry records the SHA it verified', () => {
    const dir = tmpRepo()
    const { x } = seedThroughRefactor(dir)
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
    expect(readUnifiedState(dir)?.greenVerifiedSha).toBe(x)
  })

  it('control: freezing at X itself (no new commit) is accepted', () => {
    const dir = tmpRepo()
    const { x } = seedThroughRefactor(dir)
    expect(() => runTaskReviewRound({ dir, headSha: x })).not.toThrow()
    expect(readUnifiedState(dir)?.review?.rounds).toBe(1)
  })

  it('AC-1/AC-3: freezing Y refuses until GREEN passes at Y, after the pinned test broke post-refactor', () => {
    const dir = tmpRepo()
    seedThroughRefactor(dir)
    writeFileSync(join(dir, 'review.test.ts'), BROKEN_TEST)
    const y = commit(dir, 'test: break the pinned test after refactor entry')

    expect(() => runTaskReviewRound({ dir, headSha: y })).toThrow(/GREEN/)
    // arbiter-allow-vacuous: a refused freeze persists no review state, so absent reads as round 0
    expect(readUnifiedState(dir)?.review?.rounds ?? 0).toBe(0)

    // Fix it again at a new commit Z: GREEN re-run at Z passes, freeze is then accepted, and the
    // newly-verified SHA is Z (not the stale X).
    writeFileSync(join(dir, 'review.test.ts'), PINNED_TEST)
    const z = commit(dir, 'test: restore the pinned test')
    expect(() => runTaskReviewRound({ dir, headSha: z })).not.toThrow()
    expect(readUnifiedState(dir)?.greenVerifiedSha).toBe(z)
    expect(readUnifiedState(dir)?.review?.rounds).toBe(1)
  })
})
