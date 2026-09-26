/**
 * #2926 — the review-round opener and the completion binding share ONE "reviewed source changed"
 * verdict. Content brought in by merging the base branch is not a source change; a test-only
 * commit authored on the branch is (the #2908 sequence: review → test fix → merge main).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runTaskShip } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState, reviewStateOf } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'

const TEST_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  evidenceHarness: false,
  defaultGateLevel: 'L1',
  companions: [],
}

const BRANCH = 'task/#100-review'
const REVIEW_SCRIPTS = [
  'scripts/check-review-completion.mjs',
  'scripts/lib/agent-return-validate.mjs',
  'scripts/lib/gate-args.mjs',
  'scripts/lib/evidence-binding.mjs',
  'scripts/lib/run-helpers.mjs',
  'schemas/agent-return.schema.json',
]

describe('#2926 one reviewed-source verdict for the opener and the completion binding', () => {
  let dir: string
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, ...opts })
  const commit = (path: string, body: string, msg: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), body)
    git('add', '-f', path)
    git('commit', '-q', '-m', msg)
  }
  const completion = () => {
    const r = spawnSync('node', ['scripts/check-review-completion.mjs', '--task', '#100'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    return `${r.stdout}${r.stderr}`
  }
  const query = (sha: string): Record<string, unknown> =>
    JSON.parse(
      execFileSync(
        'node',
        ['scripts/check-review-completion.mjs', '--task', '#100', `--correlated-sha=${sha}`],
        { cwd: dir, encoding: 'utf-8' },
      ),
    ) as Record<string, unknown>

  /** Review round 1 PASSes at `reviewed`, recorded exactly as #2850 D6 records it. */
  const passRound = (): string => {
    for (const path of REVIEW_SCRIPTS) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      copyFileSync(resolve(import.meta.dirname, '../..', path), join(dir, path))
    }
    git('add', 'scripts', 'schemas')
    git('commit', '-q', '-m', 'test: install review completion')
    const reviewed = git('rev-parse', 'HEAD')
    ship({ advance: true, headSha: reviewed })
    ship({ reviewRound: true, headSha: reviewed })
    const treatment = readUnifiedState(dir)?.treatment
    if (treatment === undefined) throw new Error('fixture has no persisted ship treatment')
    const panel = treatment.reviewerVerticals
    mkdirSync(join(dir, '.arbiter', 'agents-dispatched'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'agents-dispatched', '_100.json'),
      JSON.stringify({
        count: treatment.finalReviewers,
        agents: panel,
        auditors: panel,
        treatmentHash: treatment.signalsHash,
        taskId: '#100',
        branch: BRANCH,
        sha: reviewed,
      }),
    )
    const returns = join(dir, '.arbiter', 'evidence', 'agent-returns', '_100')
    mkdirSync(returns, { recursive: true })
    for (const agent of panel) {
      writeFileSync(
        join(returns, `${agent}-0.json`),
        JSON.stringify({
          schema: 'arbiter-agent-return-v1',
          agent,
          role: 'reviewer',
          taskId: '#100',
          branch: BRANCH,
          sha: reviewed,
          ts: '2026-09-26T00:00:00.000Z',
          verdict: 'PASS',
          confidence: 1,
          findings: [],
          provenance: { vendor: 'anthropic', dispatch: 'subagent' },
        }),
      )
    }
    commit('.agents/handoff.md', '# evidence only\n', 'chore: record review evidence')
    return reviewed
  }

  /** main gains a commit the branch never saw, then the branch merges origin/main. */
  const mergeMain = (): string => {
    const seed = git('rev-list', '--max-parents=0', 'HEAD')
    git('checkout', '-q', '-b', 'main', seed)
    commit('main-only.ts', 'export const fromMain = 1\n', 'feat: already on main')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    git('checkout', '-q', BRANCH)
    git('merge', '-q', '--no-edit', 'origin/main')
    return git('rev-parse', 'HEAD')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-2926-'))
    execFileSync('git', ['init', '-q', '-b', BRANCH], { cwd: dir })
    git('config', 'user.email', 'fixture@arbiter.dev')
    git('config', 'user.name', 'Fixture')
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
    writeFileSync(
      join(dir, 'plan.md'),
      '---\nfiles:\n  - review.test.ts\n---\n\n# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n',
    )
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // frozen candidate\n')
    writeFileSync(join(dir, 'green-output.mjs'), "process.stdout.write('1 passed\\n')\n")
    git('add', '.gitignore', 'plan.md', 'review.test.ts', 'green-output.mjs')
    git('commit', '-q', '-m', 'test: seed plan')
    const redSha = git('rev-parse', 'HEAD')
    runTaskShip({ dir, taskId: '#100', profileOverride: TEST_PROFILE })
    const tdd = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(tdd, { recursive: true })
    writeFileSync(
      join(tdd, '#100.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#100',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-26T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2: merging main after a PASS round changes neither verdict', () => {
    const reviewed = passRound()
    const merged = mergeMain()
    expect(query(reviewed)['sourceChanged']).toBe(false)
    expect(completion()).not.toMatch(/source changed since/)
    const step = ship({ reviewRound: true, headSha: merged })
    expect(step.reviewDispatched).toBe(false)
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 1, lastReviewedSha: reviewed })
  })

  it('AC-3: #2908 sequence (test-only commit, then merge main) is changed for both sides', () => {
    const reviewed = passRound()
    commit('review.test.ts', 'throw new Error("RED") // non-vacuous assertion\n', 'test: r2')
    const merged = mergeMain()
    expect(query(reviewed)['sourceChanged']).toBe(true)
    expect(completion()).toMatch(/review sidecar source changed since/)
    ship({ reviewRound: true, headSha: merged })
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 2, lastReviewedSha: merged })
  })
})
