// SPDX-License-Identifier: Apache-2.0
/**
 * #2402 — a PR is owned until it is merged.
 *
 * One was opened with red CI and abandoned while its task document read `complete`. The Iron Law
 * already said complete-means-merged-to-main; these tests are the mechanical form of it, plus the
 * refusal text an agent actually has to act on — the failing check names, not just "not merged".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateMerged, failingCheckNames, type PrSnapshot } from '../../src/commands/pr-merged'
import { runTaskAdvance } from '../../src/commands/task'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state'
import { writeGatePassEvidence } from '../helpers.js'

const BRANCH = 'task/#2402-owned-until-merged'

/** A config that survives `loadConfig`'s validation, so the axis under test is the only variable. */
const validConfig = (over: Record<string, unknown>): Record<string, unknown> => ({
  version: '0.2',
  governanceLevel: 'L2',
  tools: ['claude'],
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
  ...over,
})

const pr = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7,
  state: 'OPEN',
  ...over,
})

describe('failingCheckNames (#2402)', () => {
  it('names only the checks that ran and did not pass', () => {
    const snapshot = pr({
      statusCheckRollup: [
        { name: 'CI Required', conclusion: 'SUCCESS' },
        { name: 'Docs Build', conclusion: 'FAILURE' },
        { name: 'Nightly', conclusion: 'TIMED_OUT' },
        { name: 'Soak', conclusion: 'CANCELLED' },
        { name: 'Fuzz', conclusion: '' },
        { name: 'Lint', conclusion: 'SKIPPED' },
      ],
    })
    expect(failingCheckNames(snapshot)).toEqual(['Docs Build', 'Nightly', 'Soak'])
  })

  it('falls back to the legacy `context` field, then to a stand-in label', () => {
    const snapshot = pr({
      statusCheckRollup: [
        { context: 'legacy/status', conclusion: 'FAILURE' },
        { conclusion: 'FAILURE' },
      ],
    })
    expect(failingCheckNames(snapshot)).toEqual(['legacy/status', '(unnamed check)'])
  })

  it('is empty for a PR with no rollup at all', () => {
    expect(failingCheckNames(pr({ statusCheckRollup: null }))).toEqual([])
    expect(failingCheckNames(pr())).toEqual([])
  })
})

describe('evaluateMerged (#2402)', () => {
  it('AC-2402.1: a MERGED PR is a landing', () => {
    expect(evaluateMerged([pr({ state: 'MERGED' })], BRANCH)).toEqual({ merged: true, number: 7 })
  })

  it('AC-2402.1: an open PR is refused, naming the PR, its state and its failing checks', () => {
    const verdict = evaluateMerged(
      [
        pr({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          statusCheckRollup: [{ name: 'Docs Build', conclusion: 'FAILURE' }],
        }),
      ],
      BRANCH,
    )
    expect(verdict.merged).toBe(false)
    if (!verdict.merged) {
      expect(verdict.detail).toContain('PR #7')
      expect(verdict.detail).toContain('OPEN')
      expect(verdict.detail).toContain('BLOCKED')
      expect(verdict.detail).toContain('Docs Build')
      expect(verdict.detail).toContain('--no-pr')
    }
  })

  it('says so plainly when no check has gone red yet — pending is not failing', () => {
    const verdict = evaluateMerged([pr({ statusCheckRollup: [{ conclusion: '' }] })], BRANCH)
    expect(verdict.merged).toBe(false)
    if (!verdict.merged) expect(verdict.detail).toContain('No check has reported a red conclusion')
  })

  it('AC-2402.1: a branch with no PR at all gets its own next action', () => {
    const verdict = evaluateMerged([], BRANCH)
    expect(verdict.merged).toBe(false)
    if (!verdict.merged) {
      expect(verdict.detail).toContain('no PR exists')
      expect(verdict.detail).toContain(BRANCH)
    }
  })

  it('finds the merged PR even when a closed one shares the branch', () => {
    const prs = [pr({ number: 8, state: 'CLOSED' }), pr({ number: 7, state: 'MERGED' })]
    expect(evaluateMerged(prs, BRANCH)).toEqual({ merged: true, number: 7 })
  })

  it('--pr names the PR to judge, ignoring a merged sibling on the same branch', () => {
    const prs = [pr({ number: 7, state: 'MERGED' }), pr({ number: 9, state: 'OPEN' })]
    const verdict = evaluateMerged(prs, BRANCH, 9)
    expect(verdict.merged).toBe(false)
    if (!verdict.merged) expect(verdict.detail).toContain('PR #9')
  })

  it('--pr naming a PR that is not on the branch refuses rather than falling back', () => {
    const verdict = evaluateMerged([pr({ state: 'MERGED' })], BRANCH, 99)
    expect(verdict.merged).toBe(false)
    if (!verdict.merged) expect(verdict.detail).toContain('PR #99 was not found')
  })
})

describe('advance --to complete landing gate (#2402 wiring)', () => {
  let dir: string
  const log = (): string => readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')

  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }

  /**
   * #2402: the marker gate (`checkGatePassMarkerGate`, src/commands/task.ts) refuses
   * `ARBITER_SKIP_GATE_MARKER` under CI by design — CI must never honor a bypass that hides a
   * missing gate run. So instead of disarming the gate, these tests stamp a REAL gate-pass marker
   * for a real checkout, the same way __tests__/commands/task-phase-migration.test.ts does: a git
   * repo initialized on the branch under test, then `writeGatePassEvidence` (helpers.ts), which
   * builds the marker through scripts/lib/gate-evidence.mjs so head_sha/branch/tree_hash/
   * toolchain_fingerprint are bound to THIS temp checkout rather than hand-written.
   */
  const initGitRepo = (): void => {
    git(['init', '-q', '-b', BRANCH])
    git(['config', 'user.email', 'test@arbiter.dev'])
    git(['config', 'user.name', 'test-user'])
    // Mirrors arbiter's own .gitignore: task/gate runtime state is not tree content.
    writeFileSync(join(dir, '.gitignore'), '.arbiter/\n.claude/.task/\n.claude/.task-*\n', 'utf-8')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'fixture', '--no-gpg-sign'])
  }

  const stampMarker = (): void => {
    writeGatePassEvidence(dir, { taskId: '#2402' })
  }

  const seedClose = (): void => {
    writeUnifiedState(dir, { taskId: '#2402', phase: 'close', branch: BRANCH })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-landing-'))
    initGitRepo()
    // An explicit GitHub repo: the gate must fire rather than skip. Written after the initial
    // commit (untracked) so a later rewrite stays an untracked `??` line, not a dirty tracked
    // file — `git status --porcelain` gates the marker's tree_was_clean_at_run_time on that.
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(validConfig({ permitGitHub: true })))
    stampMarker()
    seedClose()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2402.1: refuses complete while the PR is unmerged, naming the red check', () => {
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => [
          { number: 7, state: 'OPEN', statusCheckRollup: [{ name: 'CI', conclusion: 'FAILURE' }] },
        ],
      }),
    ).toThrow(/NOT MERGED.*PR #7.*CI/s)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-2402.1: refuses when the branch has no PR', () => {
    expect(() => runTaskAdvance({ to: 'complete', dir, readPrs: () => [] })).toThrow(/no PR exists/)
  })

  it('AC-2402.1: an unreadable `gh` refuses — an unverifiable landing is not a landing', () => {
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => {
          throw new Error('gh: not authenticated')
        },
      }),
    ).toThrow(/not authenticated/)
  })

  it('AC-5 harness completion refuses a missing v2 receipt before reading PRs', () => {
    const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8'))
    config.features.evidenceHarness = true
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config))
    stampMarker()
    expect(() =>
      runTaskAdvance({ to: 'complete', dir, readPrs: () => [{ number: 7, state: 'MERGED' }] }),
    ).toThrow(/done receipt/)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it.each(['passed', 'pending', 'failed', 'runtime-red', 'corrupt', 'unreadable'])(
    'AC-5 native completion consumes an actual capture then handles %s',
    (state) => {
      const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8'))
      config.features.evidenceHarness = true
      config.collaborationMode = 'trunk-solo'
      config.solo = { mergeMode: 'pr-ff' }
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config))
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src/main.ts'), 'export const value = 1\n')
      writeGatePassEvidence(dir, { taskId: '#2402', level: 'L3' })
      execFileSync('node', [join(process.cwd(), 'scripts/done-evidence.mjs')], { cwd: dir })
      const path = join(dir, '.arbiter/evidence/done/_2402.json')
      const receipt = JSON.parse(readFileSync(path, 'utf8'))
      if (state === 'pending' || state === 'failed') receipt.state = state
      if (state === 'runtime-red') receipt.reality_contact = { required: true, passed: false }
      writeFileSync(path, state === 'corrupt' ? '{' : JSON.stringify(receipt))
      if (state === 'unreadable') {
        rmSync(path)
        mkdirSync(path)
      }
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      let remoteReads = 0
      const complete = () =>
        runTaskAdvance({
          to: 'complete',
          dir,
          isMergeReachable: () => true,
          readPrs: () => {
            remoteReads += 1
            return [
              {
                number: 7,
                state: 'MERGED',
                baseRefName: 'main',
                headRefOid: sha,
                mergeCommit: { oid: sha },
                mergedAt: '2026-09-09T18:36:22Z',
                statusCheckRollup: [
                  {
                    name: 'CI',
                    conclusion: 'SUCCESS',
                    completedAt: '2026-09-09T18:36:05Z',
                    checkSuite: { createdAt: '2026-09-09T18:26:48Z' },
                  },
                ],
              },
            ]
          },
        })
      if (state === 'passed') {
        complete()
        expect(readUnifiedState(dir)?.phase).toBe('complete')
        expect(remoteReads).toBe(1)
        exerciseNativeCiReader(dir, sha)
      } else {
        expect(complete).toThrow(/done receipt/)
        expect(readUnifiedState(dir)?.phase).toBe('close')
        expect(remoteReads).toBe(0)
      }
    },
  )

  it('AC-2: completes a gated-review receipt when its distinct merge reached main', () => {
    const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8'))
    config.features.evidenceHarness = true
    config.collaborationMode = 'gated-review'
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), 'export const value = 1\n')
    writeGatePassEvidence(dir, { taskId: '#2402', level: 'L3' })
    execFileSync('node', [join(process.cwd(), 'scripts/done-evidence.mjs')], { cwd: dir })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    runTaskAdvance({
      to: 'complete',
      dir,
      isMergeReachable: () => true,
      readPrs: () => [
        {
          number: 7,
          state: 'MERGED',
          baseRefName: 'main',
          headRefOid: sha,
          mergeCommit: { oid: 'b'.repeat(40) },
          mergedAt: '2026-09-09T18:36:22Z',
          statusCheckRollup: [
            {
              name: 'CI',
              conclusion: 'SUCCESS',
              completedAt: '2026-09-09T18:36:05Z',
              checkSuite: { createdAt: '2026-09-09T18:26:48Z' },
            },
          ],
        },
      ],
    })
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })

  it('AC-4: refuses an evidence receipt when raw GitHub permission is withdrawn', () => {
    const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8'))
    config.features.evidenceHarness = true
    config.collaborationMode = 'gated-review'
    config.permitGitHub = false
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), 'export const value = 1\n')
    writeGatePassEvidence(dir, { taskId: '#2402', level: 'L3' })
    execFileSync('node', [join(process.cwd(), 'scripts/done-evidence.mjs')], { cwd: dir })
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => {
          throw new Error('a denied GitHub route must not read PRs')
        },
      }),
    ).toThrow(/permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-4: refuses a legacy PR completion through a migrated useGitHub alias', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(validConfig({ permitGitHub: undefined, useGitHub: true })),
    )
    stampMarker()
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => {
          throw new Error('a denied GitHub route must not read PRs')
        },
      }),
    ).toThrow(/completion policy|raw permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-4: refuses a PR completion without raw arbiter configuration', () => {
    rmSync(join(dir, 'arbiter.json'))
    stampMarker()
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => {
          throw new Error('an unconfigured route must not read PRs')
        },
      }),
    ).toThrow(/completion policy|raw permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-4: --pr cannot borrow reachability from another PR with the same head', () => {
    const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf8'))
    config.features.evidenceHarness = true
    config.collaborationMode = 'gated-review'
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), 'export const value = 1\n')
    writeGatePassEvidence(dir, { taskId: '#2402', level: 'L3' })
    execFileSync('node', [join(process.cwd(), 'scripts/done-evidence.mjs')], { cwd: dir })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    const snapshot = (number: number, merge: string) => ({
      number,
      state: 'MERGED',
      baseRefName: 'main',
      headRefOid: sha,
      mergeCommit: { oid: merge },
      mergedAt: '2026-09-09T18:36:22Z',
      statusCheckRollup: [
        {
          name: 'CI',
          conclusion: 'SUCCESS',
          completedAt: '2026-09-09T18:36:05Z',
          checkSuite: { createdAt: '2026-09-09T18:26:48Z' },
        },
      ],
    })
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        pr: 9,
        isMergeReachable: (merge) => merge === 'a'.repeat(40),
        readPrs: () => [snapshot(7, 'a'.repeat(40)), snapshot(9, 'b'.repeat(40))],
      }),
    ).toThrow(/not reachable/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-2402.1: a merged PR completes, and the log records which PR it was', () => {
    runTaskAdvance({ to: 'complete', dir, readPrs: () => [{ number: 7, state: 'MERGED' }] })
    expect(readUnifiedState(dir)?.phase).toBe('complete')
    expect(log()).toContain('complete ← PR #7 MERGED')
  })

  it('AC-2402.1: --pr names the PR the gate judges', () => {
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        pr: 9,
        readPrs: () => [
          { number: 7, state: 'MERGED' },
          { number: 9, state: 'OPEN' },
        ],
      }),
    ).toThrow(/PR #9/)
  })

  it('AC-3: --no-pr refuses a peer-review landing before reading PRs', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(validConfig({ permitGitHub: true, collaborationMode: 'peer-review' })),
    )
    stampMarker()
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        noPr: true,
        readPrs: () => {
          throw new Error('the reader must not run under --no-pr')
        },
      }),
    ).toThrow(/--no-pr.*trunk-solo/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-3: --no-pr direct refuses a migrated useGitHub alias', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        validConfig({
          useGitHub: true,
          collaborationMode: 'trunk-solo',
          solo: { mergeMode: 'direct' },
        }),
      ),
    )
    stampMarker()
    expect(() => runTaskAdvance({ to: 'complete', dir, noPr: true })).toThrow(/raw permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-3: --no-pr direct refuses without current origin/main proof', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        validConfig({
          permitGitHub: true,
          collaborationMode: 'trunk-solo',
          solo: { mergeMode: 'direct' },
        }),
      ),
    )
    stampMarker()
    expect(() => runTaskAdvance({ to: 'complete', dir, noPr: true })).toThrow(/origin\/main/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-3: --no-pr direct refuses without a successful post-main CI result', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        validConfig({
          permitGitHub: true,
          collaborationMode: 'trunk-solo',
          solo: { mergeMode: 'direct' },
        }),
      ),
    )
    stampMarker()
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir })
    expect(() =>
      runTaskAdvance({ to: 'complete', dir, noPr: true, readCommitCi: () => [] }),
    ).toThrow(/post-main CI/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-3: --no-pr direct completes with current main and successful post-main CI', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        validConfig({
          permitGitHub: true,
          collaborationMode: 'trunk-solo',
          solo: { mergeMode: 'direct' },
        }),
      ),
    )
    stampMarker()
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    const ciCreatedAt = new Date(Date.now() - 120_000).toISOString()
    const ciCompletedAt = new Date(Date.now() - 60_000).toISOString()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir })
    runTaskAdvance({
      to: 'complete',
      dir,
      noPr: true,
      readCommitCi: () => [
        {
          name: 'CI',
          conclusion: 'SUCCESS',
          completedAt: ciCompletedAt,
          checkSuite: {
            createdAt: ciCreatedAt,
            branch: { name: 'main' },
            workflowRun: { event: 'push' },
          },
        },
      ],
    })
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })

  it('AC-3: --no-pr direct rejects CI not triggered by a main push', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        validConfig({
          permitGitHub: true,
          collaborationMode: 'trunk-solo',
          solo: { mergeMode: 'direct' },
        }),
      ),
    )
    stampMarker()
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir })
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        noPr: true,
        readCommitCi: () => [
          {
            name: 'CI',
            conclusion: 'SUCCESS',
            completedAt: new Date(Date.now() - 60_000).toISOString(),
            checkSuite: { branch: 'main', workflowRun: { event: 'pull_request' } },
          },
        ],
      }),
    ).toThrow(/post-main CI/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })

  it('AC-4: refuses a PR completion for a repo that declares it does not use GitHub', () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(validConfig({ useGitHub: false })))
    // The marker still gates unconditionally before the PR-check axis is even consulted, and it
    // is bound to tree content — re-stamp it over the rewritten arbiter.json.
    stampMarker()
    expect(() =>
      runTaskAdvance({
        to: 'complete',
        dir,
        readPrs: () => {
          throw new Error('the reader must not run for a non-GitHub repo')
        },
      }),
    ).toThrow(/raw permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('close')
  })
})

describe('#2615 candidate landing identity', () => {
  const sha = 'a'.repeat(40)
  const mergedAt = '2026-09-09T18:36:22Z'
  const ci = (conclusion = 'SUCCESS') => ({
    name: 'CI',
    conclusion,
    checkSuite: { createdAt: '2026-09-09T18:26:48Z' },
    startedAt: '2026-09-09T18:35:55Z',
    completedAt: '2026-09-09T18:36:05Z',
  })
  const landed = (): PrSnapshot =>
    pr({
      state: 'MERGED',
      headRefOid: sha,
      mergeCommit: { oid: sha },
      mergedAt,
      statusCheckRollup: [ci()],
    })
  it('AC-2: accepts a reviewed PR whose qualified head and merge commit differ on main', () => {
    expect(
      evaluateMerged(
        [
          {
            ...landed(),
            baseRefName: 'main',
            mergeCommit: { oid: 'b'.repeat(40) },
          },
        ],
        BRANCH,
        undefined,
        sha,
        { policy: 'reviewed-pr', mergeReachableFromMain: true, requireMainBase: true },
      ),
    ).toEqual({ merged: true, number: 7 })
  })
  it('AC-5 accepts only the qualified candidate with finished green CI', () => {
    expect(evaluateMerged([landed()], BRANCH, undefined, sha).merged).toBe(true)
    expect(
      evaluateMerged(
        [
          {
            ...landed(),
            statusCheckRollup: [ci(), ci('SKIPPED')],
          },
        ],
        BRANCH,
        undefined,
        sha,
      ).merged,
    ).toBe(true)
    expect(evaluateMerged([pr({ state: 'MERGED' })], BRANCH, undefined, sha).merged).toBe(false)
    expect(
      evaluateMerged([{ ...landed(), headRefOid: 'b'.repeat(40) }], BRANCH, undefined, sha).merged,
    ).toBe(false)
    expect(
      evaluateMerged(
        [{ ...landed(), mergeCommit: { oid: 'b'.repeat(40) } }],
        BRANCH,
        undefined,
        sha,
      ).merged,
    ).toBe(false)
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [ci('FAILURE')] }], BRANCH, undefined, sha)
        .merged,
    ).toBe(false)
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [ci('')] }], BRANCH, undefined, sha).merged,
    ).toBe(false)
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [] }], BRANCH, undefined, sha).merged,
    ).toBe(false)
  })
  it('AC-5 preserves qualified landing when later main checks fail or remain pending', () => {
    const later = {
      ...ci('FAILURE'),
      checkSuite: { createdAt: '2026-09-09T18:36:24Z' },
      startedAt: '2026-09-09T18:36:26Z',
      completedAt: '2026-09-09T18:37:37Z',
    }
    for (const check of [
      later,
      { ...later, conclusion: '', completedAt: '0001-01-01T00:00:00Z' },
    ]) {
      expect(
        evaluateMerged([{ ...landed(), statusCheckRollup: [ci(), check] }], BRANCH, undefined, sha)
          .merged,
      ).toBe(true)
    }
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [later] }], BRANCH, undefined, sha).merged,
    ).toBe(false)
  })

  it.each([
    { mergedAt: undefined },
    { mergedAt: 'invalid' },
    ...[
      { checkSuite: undefined },
      { checkSuite: { createdAt: 'invalid' } },
      { completedAt: undefined },
      { completedAt: 'invalid' },
      { completedAt: '2026-09-09T18:37:37Z' },
      { conclusion: '', completedAt: '0001-01-01T00:00:00Z' },
    ].map((override) => ({ statusCheckRollup: [{ ...ci(), ...override }] })),
  ])('AC-5 refuses CI that cannot establish successful completion before merge: %j', (override) => {
    expect(evaluateMerged([{ ...landed(), ...override }], BRANCH, undefined, sha).merged).toBe(
      false,
    )
  })

  it('AC-5 refuses a pre-merge suite whose queued check only starts after merge', () => {
    const queued = {
      ...ci(),
      startedAt: '2026-09-09T18:37:00Z',
      completedAt: '2026-09-09T18:38:00Z',
    }
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [ci(), queued] }], BRANCH, undefined, sha)
        .merged,
    ).toBe(false)
  })

  it('AC-5 accepts a successful status context created before merge', () => {
    const status = { context: 'external CI', state: 'SUCCESS', createdAt: '2026-09-09T18:36:05Z' }
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [status] }], BRANCH, undefined, sha).merged,
    ).toBe(true)
    const later = { ...status, createdAt: '2026-09-09T18:37:00Z' }
    expect(
      evaluateMerged([{ ...landed(), statusCheckRollup: [ci(), later] }], BRANCH, undefined, sha)
        .merged,
    ).toBe(false)
  })
})

function exerciseNativeCiReader(dir: string, sha: string): void {
  const bin = mkdtempSync(join(tmpdir(), 'arbiter-ci-gh-'))
  const originalPath = process.env.PATH
  const check = {
    name: 'CI',
    conclusion: 'SUCCESS',
    completedAt: '2026-09-09T18:36:05Z',
    checkSuite: { createdAt: '2026-09-09T18:26:48Z' },
  }
  const prs = [
    {
      number: 7,
      state: 'MERGED',
      baseRefName: 'main',
      headRefOid: sha,
      mergeCommit: { oid: sha },
      mergedAt: '2026-09-09T18:36:22Z',
    },
  ]
  const page = (nodes: unknown[], hasNextPage: boolean) => ({
    data: {
      repository: {
        object: { statusCheckRollup: { contexts: { nodes, pageInfo: { hasNextPage } } } },
      },
    },
  })
  try {
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir })
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    for (const incomplete of [false, true]) {
      writeUnifiedState(dir, { taskId: '#2402', phase: 'close', branch: BRANCH })
      const pages = [
        page([check], true),
        page(
          [{ ...check, conclusion: 'FAILURE', checkSuite: { createdAt: '2026-09-09T18:36:24Z' } }],
          incomplete,
        ),
      ]
      writeFileSync(
        join(bin, 'gh'),
        `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(join(bin, 'calls'))}, JSON.stringify(process.argv.slice(2))+String.fromCharCode(10));
process.stdout.write(JSON.stringify(process.argv[2] === 'pr' ? ${JSON.stringify(prs)} : ${JSON.stringify(pages)}));
`,
        { mode: 0o755 },
      )
      if (incomplete) {
        expect(() => runTaskAdvance({ to: 'complete', dir })).toThrow(
          /Incomplete candidate CI pages/,
        )
        expect(readUnifiedState(dir)?.phase).toBe('close')
      } else {
        runTaskAdvance({ to: 'complete', dir })
        expect(readUnifiedState(dir)?.phase).toBe('complete')
      }
    }
    const calls = readFileSync(join(bin, 'calls'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    expect(calls).toHaveLength(4)
    expect(calls[1]).toEqual(
      expect.arrayContaining(['api', 'graphql', '--paginate', '--slurp', `sha=${sha}`]),
    )
    expect(calls[1]?.find((arg) => arg.startsWith('query='))).toContain(
      'checkSuite { createdAt branch { name } workflowRun { event } }',
    )
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(bin, { recursive: true, force: true })
  }
}
