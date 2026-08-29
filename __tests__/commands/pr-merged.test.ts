// SPDX-License-Identifier: Apache-2.0
/**
 * #2402 — a PR is owned until it is merged.
 *
 * One was opened with red CI and abandoned while its task document read `complete`. The Iron Law
 * already said complete-means-merged-to-main; these tests are the mechanical form of it, plus the
 * refusal text an agent actually has to act on — the failing check names, not just "not merged".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateMerged, failingCheckNames, type PrSnapshot } from '../../src/commands/pr-merged'
import { runTaskAdvance } from '../../src/commands/task'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state'

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

  const seedClose = (): void => {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    // The marker gate runs first and is not what these tests exercise; disarm it explicitly.
    process.env['ARBITER_SKIP_GATE_MARKER'] = '1'
    writeUnifiedState(dir, { taskId: '#2402', phase: 'close', branch: BRANCH })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-landing-'))
    // An explicit GitHub repo: the gate must fire rather than skip.
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(validConfig({ permitGitHub: true })))
    seedClose()
  })

  afterEach(() => {
    delete process.env['ARBITER_SKIP_GATE_MARKER']
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

  it('AC-2402.1: --no-pr completes without a PR and LOGS the direct landing', () => {
    runTaskAdvance({
      to: 'complete',
      dir,
      noPr: true,
      readPrs: () => {
        throw new Error('the reader must not run under --no-pr')
      },
    })
    expect(readUnifiedState(dir)?.phase).toBe('complete')
    expect(log()).toContain('complete ← no-pr (direct landing)')
  })

  it('skips the gate for a repo that declares it does not use GitHub', () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(validConfig({ useGitHub: false })))
    runTaskAdvance({
      to: 'complete',
      dir,
      readPrs: () => {
        throw new Error('the reader must not run for a non-GitHub repo')
      },
    })
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })
})
