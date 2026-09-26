// SPDX-License-Identifier: Apache-2.0
/**
 * RED for arbiter#2910 — coded refusals (AC-1, AC-2, AC-4, AC-5). AC-3 (close names the
 * pr-ff lander) already holds at base for trunk-solo + pr-ff; its pin is added GREEN-side. Each `it` asserts the stated AC and, where the refusal is thrown,
 * that the error is an ArbiterError with a stable `.code` (proxy for "stderr starts with code")
 * and is NOT a bare `Error` (proxy for "never reaches the Unexpected error: branch", since cli.ts
 * only takes that branch for errors that are not instanceof ArbiterError/UserFacingError).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskInit } from '../../src/commands/task.js'
import { evaluateMerged } from '../../src/commands/pr-merged.js'
import { runTaskShip, buildShipStepLines } from '../../src/commands/task-ship.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'
import { ArbiterError } from '../../src/utils/errors.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// ── AC-1: stale native host binding names the mismatching field, coded refusal ──────────────
describe('AC-1 stale native host binding (#2910)', () => {
  function setup() {
    const parent = mkdtempSync(join(tmpdir(), 'arbiter-2910-stale-'))
    roots.push(parent)
    const main = join(parent, 'repo')
    const worktree = join(parent, 'repo.worktrees', '2910-stale')
    const home = join(parent, 'home')
    mkdirSync(main, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: main })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: main })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['worktree', 'add', '-b', 'task/#2910-stale', worktree], {
      cwd: main,
      stdio: 'ignore',
    })
    mkdirSync(join(main, '.arbiter'), { recursive: true })
    writeFileSync(
      join(main, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2910',
          worktreePath: worktree,
          branch: 'task/#2910-stale',
          bindingId: 'binding-2910',
        },
      ]),
    )
    const sessionA = 'session-a'
    const projectDir = join(home, '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${sessionA}.jsonl`), '{}\n')
    writeFileSync(join(projectDir, 'session-b.jsonl'), '{}\n')
    const hostA = { cwd: worktree, homeDir: home, env: { CLAUDE_CODE_SESSION_ID: sessionA } }
    const hostB = {
      cwd: worktree,
      homeDir: home,
      env: { CLAUDE_CODE_SESSION_ID: 'session-b' },
    }
    return { worktree, hostA, hostB }
  }

  it('a rebound Claude session refuses with a stable code naming the "session" field, never Unexpected error', () => {
    const { worktree, hostA, hostB } = setup()
    runTaskInit({ id: '#2910', worktree, dir: worktree, host: hostA })

    let thrown: unknown
    try {
      runTaskInit({ dir: worktree, id: '#2910', host: hostB })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ArbiterError) // FAILS today: thrown is a bare Error
    const err = thrown as ArbiterError
    expect(err.code).toBe('E_STALE_HOST_BINDING')
    expect(err.message).toContain('session')
    expect(err.message).toContain('lifecycle preflight')
    expect(err.message).toContain("--id '#2910'")
  })
})

// ── AC-2: complete gate refusal under exact-pr policy names both SHAs + pr-ff wording ────────
describe('AC-2 complete gate: merge-commit merge cannot satisfy pr-ff (#2910)', () => {
  it('evaluateMerged names both SHAs and says a merge-commit merge cannot satisfy pr-ff completion', () => {
    const headSha = 'a'.repeat(40)
    const mergeSha = 'b'.repeat(40)
    const verdict2 = evaluateMerged(
      [
        {
          number: 1,
          state: 'MERGED',
          headRefOid: headSha,
          mergeCommit: { oid: mergeSha },
          mergedAt: new Date().toISOString(),
        },
      ],
      '',
      undefined,
      headSha,
      { policy: 'exact-pr', mergeReachableFromMain: true, requireMainBase: false },
    )
    expect(verdict2.merged).toBe(false)
    if (!verdict2.merged) {
      expect(verdict2.detail).toContain(headSha) // FAILS today: SHAs are not named
      expect(verdict2.detail).toContain(mergeSha)
      expect(verdict2.detail).toMatch(/pr-ff/) // FAILS today: no pr-ff wording
    }
  })
})

// ── AC-4: `ship --review-round` with no reviewer seat says so before the template ────────────
describe('AC-4 ship --review-round with no reviewer seat (#2910)', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-2910-noseat-'))
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
    execFileSync(
      'git',
      [
        'add',
        '.gitignore',
        'plan.md',
        'review.test.ts',
        'green-output.mjs',
        'scripts/lib/acceptance-criteria.mjs',
      ],
      {
        cwd: dir,
      },
    )
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir })
    const redSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    runTaskShip({ dir, taskId: '#2910', profileOverride: TEST_PROFILE })
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#2910.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#2910',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-20T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
    return dir
  }

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

  it('the first output line says no reviewer was dispatched, before the reviewer-panel template', () => {
    const dir = setup()
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    runTaskShip({ dir, taskId: '#2910', profileOverride: TEST_PROFILE })
    // Enter refactor so a review round can open (mirrors ship-review.test.ts fixture pattern).
    runTaskShip({ dir, advance: true, headSha, profileOverride: TEST_PROFILE })
    const roundResult = runTaskShip({
      dir,
      reviewRound: true,
      headSha,
      profileOverride: TEST_PROFILE,
    })
    const lines = buildShipStepLines(roundResult)
    // FAILS today: lines[0] is "Phase: ..." — no reviewer-seat note is ever printed.
    expect(lines[0]).toMatch(/no reviewer/i)
    expect(lines[0]).toMatch(/independent reviewer envelope/i)
    const templateIndex = lines.findIndex((l) => l.includes('Reviewer panel template'))
    expect(templateIndex).toBeGreaterThan(0)
  })
})

// ── AC-5: stderr starts with the code, never reaches "Unexpected error:" ─────────────────────
describe('AC-5 CLI surface: coded refusals never fall through to Unexpected error (#2910)', () => {
  it('a stale host binding refusal through the built CLI starts stderr with its code', () => {
    const parent = mkdtempSync(join(tmpdir(), 'arbiter-2910-cli-'))
    roots.push(parent)
    const main = join(parent, 'repo')
    const worktree = join(parent, 'repo.worktrees', '2910-cli')
    mkdirSync(main, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: main })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: main })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['worktree', 'add', '-b', 'task/#2910-cli', worktree], {
      cwd: main,
      stdio: 'ignore',
    })
    mkdirSync(join(main, '.arbiter'), { recursive: true })
    writeFileSync(
      join(main, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2910',
          worktreePath: worktree,
          branch: 'task/#2910-cli',
          bindingId: 'binding-cli',
        },
      ]),
    )
    const cli = resolve(import.meta.dirname, '../../dist/cli.js')
    // Strip the ambient Claude session env so this exercises the pure git-binding (bindingId /
    // "task") staleness path, not the session/transcript path already covered by AC-1 directly.
    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDE_CODE_SESSION_ID
    // First bind, then rebind with a second worktree-open entry to go stale.
    spawnSync(
      process.execPath,
      [cli, 'lifecycle', 'preflight', '--id', '#2910', '--worktree', worktree],
      {
        cwd: worktree,
        encoding: 'utf-8',
        env: cleanEnv,
      },
    )
    writeFileSync(
      join(main, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2910',
          worktreePath: worktree,
          branch: 'task/#2910-cli',
          bindingId: 'binding-cli-2',
        },
      ]),
    )
    // `lifecycle start --dir` (no --worktree) is the read/verify path that re-checks the bound
    // native host against the live git state (`lifecycle preflight` only ever (re)writes it).
    const result = spawnSync(
      process.execPath,
      [cli, 'lifecycle', 'start', '--id', '#2910', '--dir', worktree],
      { cwd: worktree, encoding: 'utf-8', env: cleanEnv },
    )
    // FAILS today: stderr reads "Unexpected error: native host binding is stale ..." — no code.
    expect(result.stderr).not.toContain('Unexpected error:')
    expect(result.stderr.trimStart()).toMatch(/^Error \[E_STALE_HOST_BINDING\]:/)
  })
})
