// SPDX-License-Identifier: Apache-2.0
/**
 * arbiter#2910 review round 1 — every refusal on the native host-binding verification path is
 * the coded E_STALE_HOST_BINDING (F1/F5), the drifted `branch` and `worktree` fields are named
 * (F2), and a no-seat review round reports `reviewDispatched: false` (F4).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskInit } from '../../src/commands/task.js'
import { runTaskShip } from '../../src/commands/task-ship.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'
import { ArbiterError } from '../../src/utils/errors.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BRANCH = 'task/#2910-r2'

function bindingFixture() {
  const parent = mkdtempSync(join(tmpdir(), 'arbiter-2910-r2-'))
  roots.push(parent)
  const main = join(parent, 'repo')
  const worktree = join(parent, 'wts', 'wt')
  const home = join(parent, 'home')
  mkdirSync(main, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: main, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: main })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: main })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: main, stdio: 'ignore' })
  execFileSync('git', ['worktree', 'add', '-b', BRANCH, worktree], { cwd: main, stdio: 'ignore' })
  mkdirSync(join(main, '.arbiter'), { recursive: true })
  const entry = (branch: string, bindingId = 'binding-r2') => ({
    taskId: '#2910',
    worktreePath: worktree,
    branch,
    bindingId,
  })
  const writeLog = (rows: unknown[]) =>
    writeFileSync(join(main, '.arbiter', 'worktree-open.log.json'), JSON.stringify(rows))
  writeLog([entry(BRANCH)])
  const projectDir = (homeDir: string) =>
    join(homeDir, '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'))
  const transcript = (homeDir: string) => {
    mkdirSync(projectDir(homeDir), { recursive: true })
    const path = join(projectDir(homeDir), 'session-a.jsonl')
    writeFileSync(path, '{}\n')
    return path
  }
  const gitHost = { cwd: worktree, homeDir: home, env: {} }
  const sessionHost = { ...gitHost, env: { CLAUDE_CODE_SESSION_ID: 'session-a' } }
  return { parent, worktree, home, entry, writeLog, transcript, gitHost, sessionHost }
}

function refusalOf(verify: () => unknown): ArbiterError {
  let thrown: unknown
  try {
    verify()
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(ArbiterError)
  const err = thrown as ArbiterError
  expect(err.code).toBe('E_STALE_HOST_BINDING')
  expect(err.message).toContain(`lifecycle preflight --id '#2910'`)
  return err
}

describe('F1/F2 checkout drift is a coded stale-binding refusal (#2910)', () => {
  it('branch drift with no open-log entry starts stderr with the code through the built CLI', () => {
    const fx = bindingFixture()
    const cli = resolve(import.meta.dirname, '../../dist/cli.js')
    const env = { ...process.env }
    delete env.CLAUDE_CODE_SESSION_ID
    delete env.CLAUDE_PROJECT_DIR
    const run = (args: string[]) =>
      spawnSync(process.execPath, [cli, 'lifecycle', ...args], {
        cwd: fx.worktree,
        encoding: 'utf-8',
        env,
      })
    expect(run(['preflight', '--id', '#2910', '--worktree', fx.worktree]).status).toBe(0)
    execFileSync('git', ['checkout', '-q', '-b', 'task/#2910-other'], { cwd: fx.worktree })
    const result = run(['start', '--id', '#2910', '--dir', fx.worktree])
    expect(result.stderr).not.toContain('Unexpected error:')
    expect(result.stderr.trimStart()).toMatch(/^Error \[E_STALE_HOST_BINDING\]:/)
    expect(result.stderr).toContain('(branch no longer matches)')
    expect(result.status).not.toBe(0)
  })

  it('branch drift with an open-log entry for the new branch names "branch"', () => {
    const fx = bindingFixture()
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost })
    execFileSync('git', ['checkout', '-q', '-b', 'task/#2910-other'], { cwd: fx.worktree })
    fx.writeLog([fx.entry(BRANCH), fx.entry('task/#2910-other')])
    const err = refusalOf(() => runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.gitHost }))
    expect(err.message).toContain('(branch no longer matches)')
  })

  it('a detached HEAD after binding names "branch", never an uncoded refusal', () => {
    const fx = bindingFixture()
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost })
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: fx.worktree })
    const err = refusalOf(() => runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.gitHost }))
    expect(err.message).toContain('(branch no longer matches)')
  })

  it('preflight still refuses a detached HEAD with its own message', () => {
    const fx = bindingFixture()
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: fx.worktree })
    expect(() =>
      runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost }),
    ).toThrow(/explicit branch/)
  })

  it('a worktree whose realpath moved names "worktree"', () => {
    const fx = bindingFixture()
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost })
    renameSync(join(fx.parent, 'wts'), join(fx.parent, 'wts-moved'))
    symlinkSync(join(fx.parent, 'wts-moved'), join(fx.parent, 'wts'))
    const err = refusalOf(() => runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.gitHost }))
    expect(err.message).toContain('(worktree no longer matches)')
  })

  it.each([
    ['missing', [], 'missing or ambiguous'],
    ['ambiguous', 'duplicate', 'missing or ambiguous'],
    ['id-less', 'no-id', 'has no binding id'],
  ])('an %s open-log binding names "open-log binding" and the reason', (_label, rows, reason) => {
    const fx = bindingFixture()
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost })
    if (rows === 'duplicate') fx.writeLog([fx.entry(BRANCH), fx.entry(BRANCH)])
    else if (rows === 'no-id') fx.writeLog([fx.entry(BRANCH, '')])
    else fx.writeLog(rows as unknown[])
    const err = refusalOf(() => runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.gitHost }))
    expect(err.message).toContain('(open-log binding no longer matches)')
    expect(err.hint).toContain(reason)
  })
})

describe('F5 transcript drift is a coded stale-binding refusal (#2910)', () => {
  it('the success path still verifies an unchanged session binding', () => {
    const fx = bindingFixture()
    fx.transcript(fx.home)
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.sessionHost })
    expect(() => runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.sessionHost })).not.toThrow()
  })

  it('a transcript file that disappeared names "transcript", never an ENOENT crash', () => {
    const fx = bindingFixture()
    const path = fx.transcript(fx.home)
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.sessionHost })
    rmSync(path)
    const err = refusalOf(() =>
      runTaskInit({ dir: fx.worktree, id: '#2910', host: fx.sessionHost }),
    )
    expect(err.message).toContain('(transcript no longer matches)')
    expect(err.hint).toContain('ENOENT')
  })

  it('an invalid session id after binding names "session"', () => {
    const fx = bindingFixture()
    fx.transcript(fx.home)
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.sessionHost })
    const err = refusalOf(() =>
      runTaskInit({
        dir: fx.worktree,
        id: '#2910',
        host: { ...fx.sessionHost, env: { CLAUDE_CODE_SESSION_ID: 'not a session id' } },
      }),
    )
    expect(err.message).toContain('(session no longer matches)')
    expect(err.hint).toContain('valid CLAUDE_CODE_SESSION_ID')
  })

  it('a CLAUDE_PROJECT_DIR that no longer matches the worktree names "worktree"', () => {
    const fx = bindingFixture()
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.gitHost })
    const err = refusalOf(() =>
      runTaskInit({
        dir: fx.worktree,
        id: '#2910',
        host: { ...fx.gitHost, env: { CLAUDE_PROJECT_DIR: fx.parent } },
      }),
    )
    expect(err.message).toContain('(worktree no longer matches)')
    expect(err.hint).toContain('does not match worktree')
  })

  it('the same session resolving to a different transcript path names "transcript"', () => {
    const fx = bindingFixture()
    fx.transcript(fx.home)
    runTaskInit({ id: '#2910', worktree: fx.worktree, dir: fx.worktree, host: fx.sessionHost })
    const otherHome = join(fx.parent, 'home-b')
    fx.transcript(otherHome)
    const err = refusalOf(() =>
      runTaskInit({
        dir: fx.worktree,
        id: '#2910',
        host: { ...fx.sessionHost, homeDir: otherHome },
      }),
    )
    expect(err.message).toContain('(transcript no longer matches)')
  })
})

describe('F4 a no-seat review round dispatches nobody (#2910)', () => {
  const TEST_PROFILE = {
    isArbiterSelf: false,
    collaborationMode: 'peer-review' as const,
    mergeMode: 'pr-ff' as const,
    governanceLevel: 'L2' as const,
    autonomy: 'L0' as const,
    evidenceHarness: false,
    defaultGateLevel: 'L1' as const,
    companions: [],
  }

  function noSeatRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-2910-r2-noseat-'))
    roots.push(dir)
    execFileSync('git', ['init', '-q', '-b', 'task/#2910-noseat'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
    writeFileSync(
      join(dir, 'plan.md'),
      '---\nfiles:\n  - review.test.ts\n---\n\n# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n',
    )
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // frozen candidate\n')
    writeFileSync(join(dir, 'green-output.mjs'), "process.stdout.write('1 passed\\n')\n")
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    copyFileSync(
      resolve(import.meta.dirname, '../../scripts/lib/acceptance-criteria.mjs'),
      join(dir, 'scripts', 'lib', 'acceptance-criteria.mjs'),
    )
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir })
    const redSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' })
    runTaskShip({ dir, taskId: '#2910', profileOverride: TEST_PROFILE })
    mkdirSync(join(dir, '.arbiter', 'evidence', 'tdd'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'evidence', 'tdd', '#2910.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#2910',
        test_path: 'review.test.ts',
        test_commit_sha: redSha.trim(),
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-20T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
    return dir
  }

  it('reports reviewDispatched false alongside the "no reviewer dispatched" note', () => {
    const dir = noSeatRepo()
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    runTaskShip({ dir, taskId: '#2910', profileOverride: TEST_PROFILE })
    runTaskShip({ dir, advance: true, headSha, profileOverride: TEST_PROFILE })
    const round = runTaskShip({ dir, reviewRound: true, headSha, profileOverride: TEST_PROFILE })
    expect(round.reviewNote).toMatch(/no reviewer dispatched/)
    expect(round.reviewDispatched).toBe(false)
  })
})
