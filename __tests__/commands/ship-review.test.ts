// SPDX-License-Identifier: Apache-2.0
/**
 * #2400 — bounded review rounds with delta-only re-review.
 *
 * A refactor phase with no convergence rule re-reviews the whole diff after every fix, and
 * every full re-review finds something new: the loop terminates when someone gets tired, not
 * when the change is good. The rule is mechanical — count the rounds, scope round N ≥ 2 to
 * what changed since round N-1, and refuse round `maxRounds + 1` unless a human says so.
 *
 * RED: `review` is not on the task document, no round is ever recorded, and nothing refuses.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DEFAULT_REVIEW_MAX_ROUNDS,
  evaluateReviewRound,
  resolveReviewMaxRounds,
} from '../../src/commands/ship-review'
import { runTaskShip, buildShipStepLines } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState, reviewStateOf } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'
import { enforceAcFitCitations, validateSchema } from '../../scripts/lib/agent-return-validate.mjs'
import { validateAcFit } from '../../scripts/lib/acceptance-criteria.mjs'

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

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

describe('resolveReviewMaxRounds (#2400)', () => {
  it('defaults to two rounds', () => {
    expect(DEFAULT_REVIEW_MAX_ROUNDS).toBe(2)
    expect(resolveReviewMaxRounds(undefined)).toBe(2)
    expect(resolveReviewMaxRounds({ train: { maxChain: 3 } })).toBe(2)
  })

  it('takes the declared cap from config', () => {
    expect(resolveReviewMaxRounds({ review: { maxRounds: 4 } })).toBe(4)
  })
})

describe('evaluateReviewRound (#2400)', () => {
  it('allows every round up to the cap', () => {
    expect(evaluateReviewRound({ rounds: 0, maxRounds: 2, forced: false }).allowed).toBe(true)
    expect(evaluateReviewRound({ rounds: 1, maxRounds: 2, forced: false }).allowed).toBe(true)
  })

  it('refuses the round past the cap without weakening unresolved findings', () => {
    const verdict = evaluateReviewRound({ rounds: 2, maxRounds: 2, forced: false })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.detail).toMatch(/2/)
      expect(verdict.detail).toMatch(/BLOCKED/)
      expect(verdict.detail).toMatch(/MED\/HIGH\/CRITICAL/)
      expect(verdict.detail).toMatch(/--force-review/)
    }
  })

  it('lets an explicit --force-review through', () => {
    expect(evaluateReviewRound({ rounds: 9, maxRounds: 2, forced: true }).allowed).toBe(true)
  })
})

describe('reviewStateOf migration (#2400)', () => {
  it('AC-2400.1: a document written before review tracking reads as round 0', () => {
    expect(reviewStateOf(null)).toEqual({ rounds: 0, lastReviewedSha: null })
  })

  it('AC-2400.1: an on-disk status.json without a review key migrates to round 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-migrate-'))
    try {
      writeUnifiedState(dir, { taskId: '#100' })
      const raw = JSON.parse(
        readFileSync(join(dir, '.claude', '.task', 'status.json'), 'utf-8'),
      ) as Record<string, unknown>
      // Absent by default: a task that never reviews must not grow the key.
      expect(raw['review']).toBeUndefined()
      expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 0, lastReviewedSha: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('review rounds through arbiter ship (#2400 wiring)', () => {
  let dir: string

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, ...opts })

  const review = () => reviewStateOf(readUnifiedState(dir))
  const log = (): string => readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-review-'))
    execFileSync('git', ['init', '-q', '-b', 'task/#100-review'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
    writeFileSync(join(dir, 'plan.md'), '# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n')
    execFileSync('git', ['add', '.gitignore', 'plan.md'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed plan'], { cwd: dir })
    runTaskShip({ dir, taskId: '#100', profileOverride: TEST_PROFILE })
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('entering refactor does not consume a review round before dispatch', () => {
    ship({ advance: true, headSha: SHA_A })
    expect(review()).toEqual({ rounds: 0, lastReviewedSha: null })
  })

  it('fast-forward stops at refactor through the real review-completion gate', () => {
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', baseSha], { cwd: dir })
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED")\n')
    execFileSync('git', ['add', 'review.test.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: add red review fixture'], { cwd: dir })
    const redSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#100.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#100',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n✗ 1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-20T00:00:00.000Z',
      }),
    )
    copyFileSync(resolve(import.meta.dirname, '../../arbiter.json'), join(dir, 'arbiter.json'))
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    for (const path of [
      'scripts/check-review-completion.mjs',
      'scripts/lib/agent-return-validate.mjs',
      'scripts/lib/gate-args.mjs',
      'scripts/lib/evidence-binding.mjs',
      'scripts/lib/run-helpers.mjs',
      'schemas/agent-return.schema.json',
    ]) {
      copyFileSync(resolve(import.meta.dirname, '../..', path), join(dir, path))
    }
    execFileSync('git', ['add', 'arbiter.json', 'scripts', 'schemas'], { cwd: dir })
    execFileSync('git', ['add', '-f', '.arbiter/evidence/tdd/#100.json'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: freeze review candidate'], { cwd: dir })
    const frozenSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()

    const result = ship({ advance: true, headSha: frozenSha })

    expect(result.phase).toBe('refactor')
    expect(result.step.action).toContain(
      'advanced to refactor; next gate (verification) not yet satisfied: check-review-completion.mjs blocked',
    )
    expect(result.step.action).toContain('dispatch sidecar is required for task #100')
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
  })

  it('AC-2400.1: an explicit dispatch records round 1 and pins HEAD', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: SHA_A })
    expect(log()).toContain(`review → round 1 at ${SHA_A.slice(0, 7)}`)
  })

  it('AC-2400.1: --review-round records the next round and re-pins HEAD', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    expect(review()).toEqual({ rounds: 2, lastReviewedSha: SHA_B })
  })

  it('retrying the same frozen dispatch is idempotent even at the cap', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    const before = readFileSync(join(dir, '.claude/.task/status.json'), 'utf8')
    const beforeLog = log()
    ship({ reviewRound: true, headSha: SHA_B })
    expect(review().rounds).toBe(2)
    expect(readFileSync(join(dir, '.claude/.task/status.json'), 'utf8')).toBe(before)
    expect(log()).toBe(beforeLog)
    writeFileSync(join(dir, 'plan.md'), '# dirty plan')
    expect(() => ship({ reviewRound: true, headSha: SHA_B })).toThrow(/clean HEAD/)
  })

  it('does not burn a round just for re-reading the step', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ headSha: SHA_B })
    ship({ headSha: SHA_C })
    expect(review().rounds).toBe(1)
  })

  it('AC-2400.2: refuses a third round without --force-review, leaving state untouched', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    const before = review()
    expect(() => ship({ reviewRound: true, headSha: SHA_C })).toThrow(/REVIEW ROUNDS EXHAUSTED/)
    expect(review()).toEqual(before)
  })

  it('AC-2400.2: --force-review takes the extra round and records that it was forced', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    ship({ reviewRound: true, forceReview: true, headSha: SHA_C })
    expect(review()).toMatchObject({ rounds: 3, lastReviewedSha: SHA_C, forced: true })
    expect(log()).toContain('forced')
  })

  it('AC-2400.2: `forced` is sticky — a later ordinary round never erases the record', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    ship({ reviewRound: true, forceReview: true, headSha: SHA_B })
    ship({ reviewRound: true, reviewMaxRounds: 9, headSha: SHA_C })
    expect(review()).toMatchObject({ rounds: 3, forced: true })
  })

  it('honours a cap declared in arbiter.json', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.2',
        governanceLevel: 'L2',
        tools: ['claude'],
        useGitHub: false,
        features: {
          contractTesting: false,
          mutationTesting: false,
          securityScanning: false,
          evidenceHarness: false,
          debtGates: true,
          suppressions: true,
        },
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 65,
          maxParams: 7,
        },
        ship: { review: { maxRounds: 1 } },
      }),
    )
    execFileSync('git', ['add', 'arbiter.json'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: configure review cap'], { cwd: dir })
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    expect(() => ship({ reviewRound: true, headSha: SHA_B })).toThrow(/REVIEW ROUNDS EXHAUSTED/)
  })

  it('counts the round when HEAD cannot be read — an unreadable sha never disarms the cap', () => {
    ship({ advance: true, headSha: null })
    ship({ reviewRound: true, headSha: null })
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: null })
  })

  it('AC-2400.3: round 2 prints the delta scope and the severity rule', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_A })
    const result = ship({ reviewRound: true, headSha: SHA_B })
    const lines = buildShipStepLines(result)
    const scope = lines.find((l) => l.startsWith('Review scope:'))
    expect(scope).toBeDefined()
    expect(scope).toContain(`git diff ${SHA_A}..HEAD`)
    expect(scope).toContain('round 2 of 2')
    expect(scope).toContain('only LOW findings may be parked')
  })

  it('AC-2400.3: round 1 reviews the whole diff, so it prints no delta scope', () => {
    ship({ advance: true, headSha: SHA_A })
    const result = ship({ reviewRound: true, headSha: SHA_A })
    expect(buildShipStepLines(result).some((l) => l.startsWith('Review scope:'))).toBe(false)
  })

  it('AC-2760.2: prints a real-validator-ready envelope with every frozen AC', () => {
    writeFileSync(
      join(dir, 'plan.md'),
      [
        '# Plan',
        '## Acceptance Criteria',
        '- [ ] AC-1: first behavior',
        '- [ ] AC-2: second behavior',
        '- [ ] AC-3: third behavior',
        '## Non-Goals',
        '- no fourth behavior',
      ].join('\n'),
    )
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    copyFileSync(
      resolve(import.meta.dirname, '../../scripts/lib/acceptance-criteria.mjs'),
      join(dir, 'scripts', 'lib', 'acceptance-criteria.mjs'),
    )
    execFileSync('git', ['add', 'plan.md', 'scripts/lib/acceptance-criteria.mjs'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: freeze three acceptance criteria'], {
      cwd: dir,
    })
    const frozenSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()

    ship({ advance: true, headSha: frozenSha })
    const lines = buildShipStepLines(ship({ reviewRound: true, headSha: frozenSha }))
    const instruction =
      'Reviewer panel template: replace <ISO-8601 timestamp>, <PASS|WARN|FAIL>, <PASS|FAIL|NOT-TESTED>, and <repo-relative-path>; set numeric confidence and evidence line values.'
    const command =
      "node scripts/record-agent-return.mjs --mode reviewer-panel --task '#100' <<'JSON'"
    const start = lines.indexOf(command)
    const end = lines.indexOf('JSON', start + 1)

    expect(lines).toContain(instruction)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const printed = lines.slice(start + 1, end).join('\n')
    const filled = printed
      .replaceAll('<ISO-8601 timestamp>', '2026-09-20T00:00:00.000Z')
      .replaceAll('<PASS|WARN|FAIL>', 'PASS')
      .replaceAll('<PASS|FAIL|NOT-TESTED>', 'PASS')
      .replaceAll('<repo-relative-path>', 'plan.md')
    const panel = JSON.parse(filled) as { envelopes: Array<Record<string, unknown>> }
    const schema = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../schemas/agent-return.schema.json'), 'utf-8'),
    ) as Record<string, unknown>

    for (const envelope of panel.envelopes) {
      expect(validateSchema(envelope, schema, schema, 'template')).toEqual([])
    }
    const acceptanceFit = panel.envelopes[0]?.['acceptanceFit']
    expect(
      validateAcFit(acceptanceFit, ['AC-1', 'AC-2', 'AC-3'], { expectedTaskId: '#100' }),
    ).toEqual([])
    expect(enforceAcFitCitations(acceptanceFit, dir, frozenSha, 'template')).toEqual([])
  })

  it('does not fabricate an acceptance criterion when the frozen criteria cannot be read', () => {
    const frozenSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    ship({ advance: true, headSha: frozenSha })
    const output = buildShipStepLines(ship({ reviewRound: true, headSha: frozenSha })).join('\n')

    expect(output).toContain('Acceptance criteria unavailable from the frozen plan')
    expect(output).toMatch(/rg -n .*AC-.*plan\.md/)
    expect(output).not.toContain('<AC-ID>')
  })

  it('refuses to open a round when the frozen plan is dirty', () => {
    ship({ advance: true })
    writeFileSync(join(dir, 'plan.md'), '# changed after freeze\n')
    expect(() => ship({ reviewRound: true, headSha: SHA_A })).toThrow(/plan.*dirty|commit.*plan/i)
    expect(review()).toEqual({ rounds: 0, lastReviewedSha: null })
  })

  it('refuses to open a round when the plan is absent from HEAD', () => {
    ship({ advance: true })
    writeFileSync(join(dir, 'untracked-plan.md'), '# Plan\n')
    writeUnifiedState(dir, { plan: 'untracked-plan.md' })
    expect(() => ship({ reviewRound: true, headSha: SHA_A })).toThrow(/tracked.*plan|plan.*HEAD/i)
    expect(review()).toEqual({ rounds: 0, lastReviewedSha: null })
  })
})
