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
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DEFAULT_REVIEW_MAX_ROUNDS,
  evaluateReviewRound,
  planReviewRound,
  resolveReviewMaxRounds,
} from '../../src/commands/ship-review'
import { runTaskShip, buildShipStepLines } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState, reviewStateOf } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'
import { enforceAcFitCitations, validateSchema } from '../../scripts/lib/agent-return-validate.mjs'
import { validateAcFit } from '../../scripts/lib/acceptance-criteria.mjs'
import { FatalError } from '../../src/utils/errors.js'

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

describe('planReviewRound (#2797)', () => {
  const envelope = (sha: string, severities: string[]) => ({
    sha,
    findings: severities.map((severity) => ({ severity })),
  })

  it('does not plan a next round when round 1 has only LOW findings', () => {
    expect(
      planReviewRound({ rounds: 1, lastReviewedSha: SHA_A }, 2, SHA_B, false, {
        envelope: envelope(SHA_A, ['low']),
      }),
    ).toBeNull()
  })

  it('plans round 2 when the frozen envelope carries a MED finding', () => {
    expect(
      planReviewRound({ rounds: 1, lastReviewedSha: SHA_A }, 2, SHA_B, false, {
        envelope: envelope(SHA_A, ['med']),
      }),
    ).toMatchObject({ rounds: 2, head: SHA_B })
  })

  it('does not plan round 3 when round 2 has only LOW findings', () => {
    expect(
      planReviewRound({ rounds: 2, lastReviewedSha: SHA_B }, 2, SHA_C, false, {
        envelope: envelope(SHA_B, ['low']),
      }),
    ).toBeNull()
  })

  it('#2850 D6: plans round 2 after a PASS/LOW round when the source changed since it', () => {
    expect(
      planReviewRound({ rounds: 1, lastReviewedSha: SHA_A }, 2, SHA_B, false, {
        envelope: envelope(SHA_A, ['low']),
        sourceChanged: true,
      }),
    ).toMatchObject({ rounds: 2, base: SHA_A, head: SHA_B })
  })

  it('never plans above the cap without force, but preserves the explicit force escape hatch', () => {
    expect(planReviewRound({ rounds: 2, lastReviewedSha: SHA_B }, 2, SHA_C, false)).toMatchObject({
      allowed: false,
    })
    expect(planReviewRound({ rounds: 2, lastReviewedSha: SHA_B }, 2, SHA_C, true)).toMatchObject({
      rounds: 3,
      forced: true,
    })
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
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // frozen candidate\n')
    writeFileSync(join(dir, 'green-output.mjs'), "process.stdout.write('1 passed\\n')\n")
    execFileSync('git', ['add', '.gitignore', 'plan.md', 'review.test.ts', 'green-output.mjs'], {
      cwd: dir,
    })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed plan'], { cwd: dir })
    const redSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    runTaskShip({ dir, taskId: '#100', profileOverride: TEST_PROFILE })
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#100.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#100',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-20T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
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
        test_command: ['node', 'green-output.mjs'],
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
    writeFileSync(join(dir, 'scripts', 'check-acceptance.mjs'), 'process.exit(0)\n')
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

  it('#2850 D6: an evidence-only commit keeps a PASS round; a source commit re-reviews', () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
    // #2858: the PASS counts only through the dispatch record check-review-completion reads.
    for (const path of [
      'scripts/check-review-completion.mjs',
      'scripts/lib/agent-return-validate.mjs',
      'scripts/lib/gate-args.mjs',
      'scripts/lib/evidence-binding.mjs',
      'scripts/lib/run-helpers.mjs',
      'schemas/agent-return.schema.json',
    ]) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      copyFileSync(resolve(import.meta.dirname, '../..', path), join(dir, path))
    }
    git('add', 'scripts', 'schemas')
    git('commit', '-q', '-m', 'test: install review completion')
    const reviewed = git('rev-parse', 'HEAD')
    ship({ advance: true, headSha: reviewed })
    ship({ reviewRound: true, headSha: reviewed })
    // #2858 R2: the round verdict is the complete panel of the active treatment.
    const treatment = readUnifiedState(dir)?.treatment
    if (treatment === undefined) throw new Error('fixture has no persisted ship treatment')
    const panel = treatment.reviewerVerticals
    writeFileSync(
      join(dir, '.arbiter', 'agents-dispatched.json'),
      JSON.stringify({
        count: treatment.finalReviewers,
        agents: panel,
        auditors: panel,
        treatmentHash: treatment.signalsHash,
        taskId: '#100',
        branch: 'task/#100-review',
        sha: reviewed,
      }),
    )
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'agent-returns', '_100')
    mkdirSync(evidenceDir, { recursive: true })
    for (const agent of panel) {
      writeFileSync(
        join(evidenceDir, `${agent}-0.json`),
        JSON.stringify({
          schema: 'arbiter-agent-return-v1',
          agent,
          role: 'reviewer',
          taskId: '#100',
          branch: 'task/#100-review',
          sha: reviewed,
          ts: '2026-09-20T00:00:00.000Z',
          verdict: 'PASS',
          confidence: 1,
          findings: [],
          provenance: { vendor: 'anthropic', dispatch: 'subagent' },
        }),
      )
    }
    mkdirSync(join(dir, '.agents'), { recursive: true })
    writeFileSync(join(dir, '.agents', 'handoff.md'), '# evidence only\n')
    git('add', '.agents/handoff.md')
    git('commit', '-q', '-m', 'chore: record handoff')
    const evidenceOnly = ship({ reviewRound: true, headSha: git('rev-parse', 'HEAD') })
    expect(evidenceOnly.reviewDispatched).toBe(false)
    expect(buildShipStepLines(evidenceOnly).join('\n')).toMatch(/review round: not opened/)
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: reviewed })

    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // fix after review\n')
    git('add', 'review.test.ts')
    git('commit', '-q', '-m', 'fix: address review')
    const fixed = git('rev-parse', 'HEAD')
    const rereview = ship({ reviewRound: true, headSha: fixed })
    expect(rereview.reviewDispatched).toBe(true)
    expect(review()).toEqual({ rounds: 2, lastReviewedSha: fixed })
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

  it('refuses the freeze while a template commit is newer than the bake snapshots (#2863 AC-4)', () => {
    const commit = (files: string[], message: string) => {
      for (const file of files) {
        mkdirSync(join(dir, file, '..'), { recursive: true })
        writeFileSync(join(dir, file), `${message}\n`)
      }
      execFileSync('git', ['add', ...files], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir })
    }
    const snapshot = '__tests__/integration/e2e/bake/__snapshots__/ts-cli.json'
    const template = 'src/templates/AGENTS.md.ejs'
    ship({ advance: true, headSha: SHA_A })
    commit([template], 'fix: template before any rebake')
    ship({ reviewRound: true, headSha: SHA_A })

    writeUnifiedState(dir, {
      derivedGates: [
        {
          name: 'integration suite (INV-25)',
          kind: 'artifact-regenerate',
          command: 'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
        },
      ],
    })
    expect(() => ship({ reviewRound: true, headSha: SHA_B })).toThrow(
      /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/,
    )
    commit([snapshot], 'test: rebake')
    commit([template], 'fix: template after the rebake')
    expect(() => ship({ reviewRound: true, headSha: SHA_B })).toThrow(
      /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/,
    )
    expect(review().rounds).toBe(1)
    commit([snapshot], 'test: rebake again')
    ship({ reviewRound: true, headSha: SHA_B })
    commit([template, snapshot], 'fix: template and rebake together')
    ship({ reviewRound: true, headSha: SHA_B })
    expect(review().rounds).toBe(2)
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
    writeFileSync(join(dir, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(dir, 'untracked-plan.md'), '# Plan\n')
    writeUnifiedState(dir, { plan: 'untracked-plan.md' })
    expect(() => ship({ reviewRound: true, headSha: SHA_A })).toThrow(/tracked.*plan|plan.*HEAD/i)
    expect(review()).toEqual({ rounds: 0, lastReviewedSha: null })
  })
})

describe('review rounds own the Codex seat (#2747)', () => {
  let dir: string
  const codexAccess = {
    provider: 'codex' as const,
    vendor: 'openai',
    available: true,
    authenticated: true,
    version: '1.2.3',
    error: null,
  }
  const codexConfig = {
    enabled: true,
    diffEgressConsent: true,
    providers: ['codex'] as const,
    slots: { codeReview: 1, redTeamReview: 0 },
    timeoutMs: 30_000,
    onUnavailable: 'degrade' as const,
  }
  const codexProfile = {
    ...TEST_PROFILE,
    crossModelReview: codexConfig,
  }

  function installCodex(output: string | null, delayMs = 0): string {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    if (output === null) return bin
    const escaped = output.replaceAll("'", "'\\''")
    const codex = join(bin, 'codex')
    writeFileSync(
      codex,
      '#!/bin/sh\n' +
        (delayMs > 0 ? `sleep ${delayMs / 1000}\n` : '') +
        'out=""\n' +
        'while [ "$#" -gt 0 ]; do\n' +
        '  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi\n' +
        'done\n' +
        'cat >/dev/null\n' +
        `printf '%s\\n' '${escaped}' > "$out"\n`,
      'utf8',
    )
    chmodSync(codex, 0o755)
    return bin
  }

  function seedRuntimeFixture(
    extraScripts: readonly string[] = [],
    extraFiles: Record<string, string> = {},
  ): string {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-review-runtime-'))
    execFileSync('git', ['init', '-q', '-b', 'task/#2747-review-runtime'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\nbin/\n')
    writeFileSync(join(dir, 'plan.md'), '# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n')

    for (const relativePath of [
      '.claude/hooks/lib.mjs',
      'schemas/agent-return-external.schema.json',
      'schemas/agent-return.schema.json',
      'scripts/check-review-completion.mjs',
      'scripts/record-agent-return.mjs',
      'scripts/lib/acceptance-criteria.mjs',
      'scripts/lib/agent-return-validate.mjs',
      'scripts/lib/evidence-binding.mjs',
      'scripts/lib/gate-args.mjs',
      'scripts/lib/run-helpers.mjs',
      'scripts/lib/suppressions-shared.mjs',
      ...extraScripts,
    ]) {
      const target = join(dir, relativePath)
      mkdirSync(join(target, '..'), { recursive: true })
      copyFileSync(join(process.cwd(), relativePath), target)
    }
    for (const [relativePath, content] of Object.entries(extraFiles)) {
      writeFileSync(join(dir, relativePath), content)
    }

    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed review runtime'], { cwd: dir })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir })

    runTaskShip({ dir, taskId: '#2747', profileOverride: codexProfile })
    writeUnifiedState(dir, {
      phase: 'refactor',
      plan: 'plan.md',
      branch: 'task/#2747-review-runtime',
    })
    return sha
  }

  function runRound(output: string | null, options: { delayMs?: number; timeoutMs?: number } = {}) {
    const sha = seedRuntimeFixture()
    const bin = installCodex(output, options.delayMs)
    // The fixture bin comes first; a missing fixture must not fall through to a real codex on the host.
    vi.stubEnv(
      'PATH',
      output === null ? `${bin}:/usr/bin:/bin` : `${bin}:${process.env.PATH ?? ''}`,
    )
    const config = { ...codexConfig, timeoutMs: options.timeoutMs ?? codexConfig.timeoutMs }
    return runTaskShip({
      dir,
      reviewRound: true,
      headSha: sha,
      profileOverride: { ...TEST_PROFILE, crossModelReview: config },
      externalModelAccess: codexAccess,
    })
  }

  const passingFit =
    '"acceptanceFit":{"schema":"arbiter-ac-fit-v1","taskId":"#2747","criteria":[{"id":"AC-1","verdict":"PASS","evidence":[{"file":"plan.md","line":4}]}]}'

  afterEach(() => {
    vi.unstubAllEnvs()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it('runs the Codex seat in the foreground, records provenance, and passes completion', () => {
    const result = runRound(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
    )

    expect(buildShipStepLines(result)).toContain(
      'review round 1: PASS — 0 findings (0 blocking) · next: advance',
    )
    expect(buildShipStepLines(result).join('\n')).not.toContain('record-agent-return')
    expect(readUnifiedState(dir)?.review).toEqual({
      rounds: 1,
      lastReviewedSha: expect.any(String),
    })
    const envelopePath = join(dir, '.arbiter', 'evidence', 'agent-returns', '_2747')
    const envelope = JSON.parse(
      readFileSync(join(envelopePath, readdirSync(envelopePath)[0]!), 'utf8'),
    )
    expect(envelope.provenance).toEqual({
      vendor: 'openai',
      dispatch: 'external-cli',
      cli: 'codex',
      cliVersion: '1.2.3',
    })
  })

  it('completes LOW-only rounds and spools each LOW finding without a next round', () => {
    const result = runRound(
      `{"verdict":"WARN","confidence":0.8,"findings":[{"id":"low-1","severity":"low","kind":"style","claim":"The wording could be clearer.","citations":[]},{"id":"low-2","severity":"low","kind":"behavioral","claim":"The plan should name the proof.","citations":[{"file":"plan.md","line":1}]}],"refutations":[],${passingFit}}`,
    )

    expect(buildShipStepLines(result)).toContain(
      'review round 1: WARN — 2 findings (0 blocking) · next: parked',
    )
    const spool = join(dir, '.arbiter', 'findings', '_2747.jsonl')
    expect(existsSync(spool)).toBe(true)
    const findings = readFileSync(spool, 'utf8').trim().split('\n').map(JSON.parse)
    expect(findings[0]).toMatchObject({
      note: 'The wording could be clearer.',
      severity: 'low',
    })
    expect(findings[1]).toMatchObject({
      note: 'The plan should name the proof.',
      severity: 'low',
      file: 'plan.md',
      line: 1,
    })
    expect(readUnifiedState(dir)?.review?.rounds).toBe(1)
  })

  it('keeps a blocking reviewer finding in rework without spooling it as LOW debt', () => {
    const result = runRound(
      '{"verdict":"FAIL","confidence":1,"findings":[{"id":"high-1","severity":"high","kind":"behavioral","claim":"The acceptance behavior is broken.","citations":[{"file":"plan.md","line":1}]}],"refutations":[],"acceptanceFit":{"schema":"arbiter-ac-fit-v1","taskId":"#2747","criteria":[{"id":"AC-1","verdict":"FAIL","evidence":[{"file":"plan.md","line":4}]}]}}',
    )

    expect(buildShipStepLines(result)).toContain(
      'review round 1: FAIL — 1 findings (1 blocking) · next: rework',
    )
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'agent-returns', '_2747'))).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'ac-fit', '2747.json'))).toBe(false)
    expect(existsSync(join(dir, '.arbiter', 'findings', '_2747.jsonl'))).toBe(false)
  })

  it.each([
    ['missing Codex', null, 30_000, 0],
    [
      'timed-out Codex',
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      20,
      1000,
    ],
    ['unparseable Codex output', 'not json', 30_000, 0],
  ])(
    '%s exits through the fatal no-data path without an envelope',
    (_label, output, timeoutMs, delayMs) => {
      let thrown: unknown
      try {
        runRound(output, { timeoutMs, delayMs })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(FatalError)
      expect(thrown).toMatchObject({ kind: 'fatal', code: 'E_REVIEW_NO_DATA' })
      expect(existsSync(join(dir, '.arbiter', 'evidence', 'agent-returns', '_2747'))).toBe(false)
      expect(readUnifiedState(dir)?.review?.rounds).toBe(1)
    },
  )

  it('retries a no-data round at a newer HEAD without consuming another round', () => {
    const originalPath = process.env.PATH ?? ''
    const firstSha = seedRuntimeFixture()
    const missingBin = installCodex(null)
    vi.stubEnv('PATH', `${missingBin}:/usr/bin:/bin`)

    expect(() =>
      runTaskShip({
        dir,
        reviewRound: true,
        headSha: firstSha,
        profileOverride: codexProfile,
        externalModelAccess: codexAccess,
      }),
    ).toThrow(FatalError)

    writeFileSync(join(dir, 'candidate.ts'), 'export const candidate = true\n')
    execFileSync('git', ['add', 'candidate.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'fix: prepare review retry'], { cwd: dir })
    const secondSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim()
    const reviewerBin = installCodex(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
    )
    vi.stubEnv('PATH', `${reviewerBin}:${originalPath}`)

    const result = runTaskShip({
      dir,
      reviewRound: true,
      headSha: secondSha,
      profileOverride: codexProfile,
      externalModelAccess: codexAccess,
    })

    expect(buildShipStepLines(result)).toContain(
      'review round 1: PASS — 0 findings (0 blocking) · next: advance',
    )
    expect(readUnifiedState(dir)?.review).toEqual({ rounds: 1, lastReviewedSha: secondSha })
  })

  function commitFix(): string {
    writeFileSync(join(dir, 'candidate.ts'), 'export const candidate = true\n')
    execFileSync('git', ['add', 'candidate.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'fix: address review'], { cwd: dir })
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  }

  function reviewWith(
    output: string,
    headSha: string,
    originalPath: string,
    profile = codexProfile,
  ) {
    vi.stubEnv('PATH', `${installCodex(output)}:${originalPath}`)
    return runTaskShip({
      dir,
      reviewRound: true,
      headSha,
      profileOverride: profile,
      externalModelAccess: codexAccess,
    })
  }

  const blockingFail =
    '{"verdict":"FAIL","confidence":1,"findings":[{"id":"high-1","severity":"high","kind":"behavioral","claim":"The acceptance behavior is broken.","citations":[{"file":"plan.md","line":1}]}],"refutations":[],"acceptanceFit":{"schema":"arbiter-ac-fit-v1","taskId":"#2747","criteria":[{"id":"AC-1","verdict":"FAIL","evidence":[{"file":"plan.md","line":4}]}]}}'

  const rejectedByRecorder = `{"verdict":"PASS","confidence":1,"findings":[{"id":"s-1","severity":"low","kind":"structural","claim":"Cites a file the subject lacks.","citations":[{"file":"missing-2858.ts","line":1}]}],"refutations":[],${passingFit}}`

  function rejectedRound(fixed: string, originalPath: string): unknown {
    try {
      reviewWith(rejectedByRecorder, fixed, originalPath)
    } catch (error) {
      return error
    }
    return undefined
  }

  it('#2858: E_REVIEW_NO_DATA carries the recorder exit code and output tail', () => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    const thrown = rejectedRound(commitFix(), originalPath)

    expect(thrown).toMatchObject({ code: 'E_REVIEW_NO_DATA' })
    expect(String((thrown as Error).message)).toMatch(/recorder exit 1: .*missing-2858\.ts/s)
  })

  it('#2858: an undispatched envelope never closes the open round; the native retry does', () => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    const fixed = commitFix()

    expect(rejectedRound(fixed, originalPath)).toMatchObject({ code: 'E_REVIEW_NO_DATA' })
    expect(readUnifiedState(dir)?.review).toEqual({ rounds: 2, lastReviewedSha: fixed })

    const returns = join(dir, '.arbiter', 'evidence', 'agent-returns', '_2747')
    const foreign = join(returns, `codex-reviewer-${readdirSync(returns).length}.json`)
    writeFileSync(
      foreign,
      JSON.stringify({
        schema: 'arbiter-agent-return-v1',
        agent: 'codex-reviewer',
        role: 'reviewer',
        taskId: '#2747',
        branch: 'task/#2747-review-runtime',
        sha: fixed,
        ts: '2026-09-24T00:00:00.000Z',
        verdict: 'PASS',
        confidence: 1,
        findings: [],
        provenance: { vendor: 'anthropic', dispatch: 'subagent' },
      }),
    )

    const result = reviewWith(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      fixed,
      originalPath,
    )

    expect(buildShipStepLines(result)).toContain(
      'review round 2: PASS — 0 findings (0 blocking) · next: advance',
    )
    expect(readUnifiedState(dir)?.review).toEqual({ rounds: 2, lastReviewedSha: fixed })
    expect(existsSync(foreign)).toBe(true)
  })

  it('#2858: a native blocking verdict still counts, so the fix opens the next round', () => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    const fixed = commitFix()

    const result = reviewWith(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      fixed,
      originalPath,
    )

    expect(buildShipStepLines(result)).toContain(
      'review round 2: PASS — 0 findings (0 blocking) · next: advance',
    )
    expect(readUnifiedState(dir)?.review).toEqual({ rounds: 2, lastReviewedSha: fixed })
    const again = reviewWith(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      fixed,
      originalPath,
    )
    expect(again.reviewDispatched).toBe(false)
    expect(readUnifiedState(dir)?.review).toEqual({ rounds: 2, lastReviewedSha: fixed })
  })

  it('#2858 R2: onUnavailable fail still carries the recorder exit code and output tail', () => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    const fixed = commitFix()

    let thrown: unknown
    try {
      reviewWith(rejectedByRecorder, fixed, originalPath, {
        ...TEST_PROFILE,
        crossModelReview: { ...codexConfig, onUnavailable: 'fail' as const },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'E_REVIEW_NO_DATA' })
    expect(String((thrown as Error).message)).toMatch(/recorder exit 1: .*missing-2858\.ts/s)
  })

  it('#2858 R2: a dangling dispatch-record symlink is an error, not an absent round', () => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    const sidecar = join(dir, '.arbiter', 'agents-dispatched.json')
    rmSync(sidecar)
    symlinkSync(join(dir, 'does-not-exist.json'), sidecar)
    const reviewed = readUnifiedState(dir)?.review

    expect(() =>
      reviewWith(
        `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
        commitFix(),
        originalPath,
      ),
    ).toThrow(/agents-dispatched\.json is a symlink/)
    expect(readUnifiedState(dir)?.review).toEqual(reviewed)
  })

  it.each([
    ['exits 1 with its gate report', "console.error('FAIL review completion'); process.exit(1)\n"],
    ['exits 0 with its gate report', "console.log('PASS review completion')\n"],
  ])('#2858 R2: a pre-#2858 consumer checker that %s names the update command', (_label, body) => {
    const originalPath = process.env.PATH ?? ''
    runRound(blockingFail)
    writeFileSync(join(dir, 'scripts', 'check-review-completion.mjs'), body)
    execFileSync('git', ['add', 'scripts/check-review-completion.mjs'], { cwd: dir })
    const reviewed = readUnifiedState(dir)?.review

    expect(() =>
      reviewWith(
        `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
        commitFix(),
        originalPath,
      ),
    ).toThrow(/arbiter update --only scripts\/check-review-completion\.mjs/)
    expect(readUnifiedState(dir)?.review).toEqual(reviewed)
  })

  function firstMixedPanelRound(output: string, originalPath: string): string {
    const sha = seedRuntimeFixture(
      ['scripts/check-cross-model-review.mjs', 'schemas/cross-model-dispatch.schema.json'],
      {
        'arbiter.json': JSON.stringify({ crossModelReview: codexConfig }),
      },
    )
    const seeded = readUnifiedState(dir)?.treatment
    writeUnifiedState(dir, {
      treatment: {
        ...seeded!,
        tier: 'Standard',
        sensitive: true,
        finalReviewers: 2,
        reviewerVerticals: ['security', 'data-integrity'],
      },
    })
    reviewWith(output, sha, originalPath)
    const sidecar = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8'),
    )
    expect(sidecar).toMatchObject({
      count: 2,
      agents: ['anthropic-reviewer', 'codex-reviewer'],
      treatmentHash: readUnifiedState(dir)?.treatment?.signalsHash,
    })
    return sha
  }

  /** The retry's Codex fails loudly, so a reused seat is the only way the round can still answer. */
  function retryWithFailingCodex(sha: string, originalPath: string) {
    const marker = join(dir, 'bin', 'codex-invoked')
    const bin = join(dir, 'bin', 'retry')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, 'utf8')
    chmodSync(join(bin, 'codex'), 0o755)
    vi.stubEnv('PATH', `${bin}:${originalPath}`)
    const retry = () =>
      runTaskShip({
        dir,
        reviewRound: true,
        headSha: sha,
        profileOverride: codexProfile,
        externalModelAccess: codexAccess,
      })
    return { retry, marker }
  }

  function codexReturnFiles(): string[] {
    const root = join(dir, '.arbiter')
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((path) => /(^|\/)codex-reviewer[^/]*\.json$/.test(path))
      .map((path) => join(root, path))
  }

  it.each([
    ['PASS', 'review round 1: PASS — 0 findings (0 blocking) · next: rework'],
    ['blocking', 'review round 1: FAIL — 1 findings (1 blocking) · next: rework'],
  ])(
    '#2858 R3: a mixed-panel retry reuses the admitted %s Codex seat instead of crashing',
    (verdict, round) => {
      const originalPath = process.env.PATH ?? ''
      const sha = firstMixedPanelRound(
        verdict === 'PASS'
          ? `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`
          : blockingFail,
        originalPath,
      )
      const { retry, marker } = retryWithFailingCodex(sha, originalPath)

      expect(buildShipStepLines(retry())).toContain(round)
      expect(existsSync(marker)).toBe(false)
      expect(readUnifiedState(dir)?.review).toEqual({ rounds: 1, lastReviewedSha: sha })
    },
  )

  it('#2858 R3: every admitted Codex shard counts on reuse — the worst verdict and all findings', () => {
    const originalPath = process.env.PATH ?? ''
    const sha = firstMixedPanelRound(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      originalPath,
    )
    const [first] = codexReturnFiles()
    const shard = JSON.parse(readFileSync(first!, 'utf8')) as Record<string, unknown>
    delete shard['refutations']
    delete shard['acceptanceFit']
    writeFileSync(
      join(first!, '..', 'codex-reviewer-2858.json'),
      JSON.stringify({
        ...shard,
        verdict: 'WARN',
        confidence: 0.5,
        findings: [
          {
            id: 'low-1',
            severity: 'low',
            kind: 'structural',
            claim: 'A second shard carries its own finding.',
            citations: [{ file: 'plan.md', line: 1 }],
          },
        ],
      }),
    )
    const { retry, marker } = retryWithFailingCodex(sha, originalPath)

    expect(buildShipStepLines(retry())).toContain(
      'review round 1: WARN — 1 findings (0 blocking) · next: rework',
    )
    expect(existsSync(marker)).toBe(false)
  })

  it('#2858 R3: a missing Codex return is a cache miss, so the retry dispatches Codex again', () => {
    const originalPath = process.env.PATH ?? ''
    const sha = firstMixedPanelRound(
      `{"verdict":"PASS","confidence":1,"findings":[],"refutations":[],${passingFit}}`,
      originalPath,
    )
    const returns = codexReturnFiles()
    expect(returns).not.toHaveLength(0)
    for (const file of returns) rmSync(file)
    const { retry, marker } = retryWithFailingCodex(sha, originalPath)

    expect(retry).toThrow(/Codex reviewer returned no data \(invocation-failed\)/)
    expect(existsSync(marker)).toBe(true)
  })

  it('keeps plan-only behavior when the planned treatment has no Codex seat', () => {
    const sha = seedRuntimeFixture()
    const bin = installCodex('{"verdict":"PASS","confidence":1,"findings":[],"refutations":[]}')
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)

    const result = runTaskShip({
      dir,
      reviewRound: true,
      headSha: sha,
      profileOverride: {
        ...TEST_PROFILE,
        crossModelReview: { ...codexConfig, slots: { codeReview: 0, redTeamReview: 0 } },
      },
      externalModelAccess: codexAccess,
    })

    expect(result.reviewDispatched).toBe(true)
    expect(buildShipStepLines(result).some((line) => line.startsWith('review round '))).toBe(false)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'agent-returns', '_2747'))).toBe(false)
  })
})
