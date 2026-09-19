// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/ship-kpi.test.ts
//
// #2398: throughput KPI script. Pure predicate unit tests (direct import, no
// `gh`/`git` calls) + a real spawn of --self-test (CANON-07: generated
// scripts must be executed in tests, not just string-matched).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as shipKpi from '../../scripts/ship-kpi.mjs'
import {
  isEvidenceOnlySubject,
  isEvidenceOnlyCommit,
  isReviewLoopSubject,
  firstNonFeatIndex,
  countReviewLoopCommits,
  isAllEvidencePaths,
  parseGitShowStatPaths,
  leadTimeHours,
  median,
  pct,
  hasFailureConclusion,
  isStaleOpenPr,
  classifyPrCommits,
  buildPrRow,
  computeAggregate,
  findEscapes,
} from '../../scripts/ship-kpi.mjs'

// #2725 classifier exports are read from the namespace so the test keeps the
// existing import list focused on the pre-existing KPI predicates.
const splitLeadTime = Reflect.get(shipKpi, 'splitLeadTime') as (...args: unknown[]) => unknown
const sessionUsage = Reflect.get(shipKpi, 'sessionUsage') as (...args: unknown[]) => unknown
const stratumOf = Reflect.get(shipKpi, 'stratumOf') as (...args: unknown[]) => unknown
const quantiles = Reflect.get(shipKpi, 'quantiles') as (...args: unknown[]) => unknown
const costUnits = Reflect.get(shipKpi, 'costUnits') as (...args: unknown[]) => unknown
const overheadIndices = Reflect.get(shipKpi, 'overheadIndices') as (...args: unknown[]) => unknown
const calibrate = Reflect.get(shipKpi, 'calibrate') as (...args: unknown[]) => unknown
const checkpointVerdict = Reflect.get(shipKpi, 'checkpointVerdict') as (
  ...args: unknown[]
) => unknown
const formatLogEntry = Reflect.get(shipKpi, 'formatLogEntry') as (...args: unknown[]) => unknown
const ciTiming = Reflect.get(shipKpi, 'ciTiming') as (...args: unknown[]) => unknown
const issueIdsOf = Reflect.get(shipKpi, 'issueIdsOf') as (...args: unknown[]) => unknown
const attributeSessions = Reflect.get(shipKpi, 'attributeSessions') as (
  ...args: unknown[]
) => unknown
const claudeSessionMeta = Reflect.get(shipKpi, 'claudeSessionMeta') as (
  ...args: unknown[]
) => unknown
const codexSessionMeta = Reflect.get(shipKpi, 'codexSessionMeta') as (...args: unknown[]) => unknown
const discoverSessions = Reflect.get(shipKpi, 'discoverSessions') as (...args: unknown[]) => unknown
const unattributedUsage = Reflect.get(shipKpi, 'unattributedUsage') as (
  ...args: unknown[]
) => unknown
const renderMarkdown = Reflect.get(shipKpi, 'renderMarkdown') as (...args: unknown[]) => unknown
const mergeDeliverySources = Reflect.get(shipKpi, 'mergeDeliverySources') as (
  ...args: unknown[]
) => unknown

// PATH scoped to node's OWN directory only — `gh`/`git` are unreachable, so if
// --self-test ever shells out it throws instead of silently succeeding.
const NODE_ONLY_PATH = dirname(process.execPath)

describe('isEvidenceOnlySubject / isEvidenceOnlyCommit (#2398)', () => {
  it('matches "chore(#N): refresh ... evidence"', () => {
    expect(isEvidenceOnlySubject('chore(#2354): refresh wave evidence')).toBe(true)
  })

  it('matches "chore(#N): align ... manifest"', () => {
    expect(isEvidenceOnlySubject('chore(#2354): align delivery manifest')).toBe(true)
  })

  it('does not match a feat commit', () => {
    expect(isEvidenceOnlySubject('feat(#100): add widget')).toBe(false)
  })

  it('a non-matching subject with all-evidence-path touch is still evidence-only', () => {
    expect(isEvidenceOnlyCommit('fix(#100): typo', true)).toBe(true)
  })

  it('a non-matching subject with mixed-path touch is not evidence-only', () => {
    expect(isEvidenceOnlyCommit('fix(#100): typo', false)).toBe(false)
  })

  it('touchedOnlyEvidencePaths undefined (sha not local) falls back to subject-only', () => {
    expect(isEvidenceOnlyCommit('chore(#1): refresh evidence', undefined)).toBe(true)
    expect(isEvidenceOnlyCommit('fix(#1): typo', undefined)).toBe(false)
  })
})

describe('findEscapes (#2725 AC-4)', () => {
  const delivery = {
    number: 270,
    mergedAt: '2026-09-01T00:00:00Z',
    issueIds: [2725],
    commitShas: ['ownsha'],
  }

  it('finds a revert of a merged delivery inside the escape window', () => {
    expect(
      findEscapes(
        [delivery],
        [
          {
            sha: 'revertsha',
            date: '2026-09-05T00:00:00Z',
            subject: 'Revert "Merge pull request #270"',
            body: '',
          },
        ],
        14,
      ),
    ).toEqual([
      {
        pr: 270,
        sha: 'revertsha',
        kind: 'revert',
        subject: 'Revert "Merge pull request #270"',
      },
    ])
  })

  it('finds a fix that cites a delivery issue inside the escape window', () => {
    expect(
      findEscapes(
        [delivery],
        [
          {
            sha: 'fixsha',
            date: '2026-09-05T00:00:00Z',
            subject: 'fix: repair the regression',
            body: 'Follow-up for #2725.',
          },
        ],
        14,
      ),
    ).toEqual([
      {
        pr: 270,
        sha: 'fixsha',
        kind: 'fix',
        subject: 'fix: repair the regression',
      },
    ])
  })

  it.each([
    ['rejects a commit outside the window', '2026-09-16T00:00:00Z', 'fix: repair #270', ''],
    ['rejects a delivery own commit', '2026-09-05T00:00:00Z', 'fix: repair #270', ''],
    ['rejects a digit-boundary partial match', '2026-09-05T00:00:00Z', 'fix: repair #2703', ''],
    ['rejects chore/docs/test commits', '2026-09-05T00:00:00Z', 'docs: explain #270', ''],
  ])('%s', (name, date, subject, body) => {
    const mainCommit = {
      sha: name.includes('own commit') ? 'ownsha' : 'other-sha',
      date,
      subject,
      body,
    }
    expect(findEscapes([delivery], [mainCommit], 14)).toEqual([])
  })

  it('does not turn red CI rework into an escape or ANDON', () => {
    expect(findEscapes([{ ...delivery, ciRedAtOpen: true, redCiRuns: 1 }], [], 14)).toEqual([])
    expect(
      checkpointVerdict({
        current: {
          n: 10,
          indices: {
            time: { median: 1, p90: 1 },
            tokens: { median: 1, p90: 1 },
          },
          maxOverhead: 1,
          escapes: [],
        },
        thresholds: { n: 10 },
      }),
    ).toBe('HOLD')
  })
})

describe('isReviewLoopSubject / countReviewLoopCommits (#2398)', () => {
  it('matches "close ... gaps"', () => {
    expect(isReviewLoopSubject('fix(#100): close review gaps')).toBe(true)
  })

  it('matches "harden ... bypass"', () => {
    expect(isReviewLoopSubject('fix(#100): harden the evidence bypass')).toBe(true)
  })

  it('does not match an unrelated fix', () => {
    expect(isReviewLoopSubject('fix(#100): correct off-by-one')).toBe(false)
  })

  it('firstNonFeatIndex finds the first non-feat commit', () => {
    expect(firstNonFeatIndex(['feat(#1): a', 'feat(#1): b', 'fix(#1): c'])).toBe(2)
  })

  it('firstNonFeatIndex is -1 when every commit is feat', () => {
    expect(firstNonFeatIndex(['feat(#1): a', 'feat(#1): b'])).toBe(-1)
  })

  it('counts review-loop commits only after the first non-feat commit', () => {
    const subjects = [
      'feat(#1): add thing',
      'fix(#1): close review gaps', // this IS the boundary commit — not counted
      'fix(#1): harden the bypass', // counted
      'style(#1): format', // not counted (no match)
      'fix(#1): reject the regression', // counted
    ]
    expect(countReviewLoopCommits(subjects)).toBe(2)
  })

  it('is 0 when there is no non-feat boundary commit', () => {
    expect(countReviewLoopCommits(['feat(#1): a'])).toBe(0)
  })
})

describe('isAllEvidencePaths / parseGitShowStatPaths (#2398)', () => {
  it('true when every path is under .arbiter/ or .agents/', () => {
    expect(isAllEvidencePaths(['.arbiter/evidence/tdd/1.json', '.agents/notes.md'])).toBe(true)
  })

  it('false when any path is outside .arbiter/ or .agents/', () => {
    expect(isAllEvidencePaths(['.arbiter/evidence/tdd/1.json', 'src/index.ts'])).toBe(false)
  })

  it('false for an empty path list', () => {
    expect(isAllEvidencePaths([])).toBe(false)
  })

  it('parses paths out of a git show --stat diffstat', () => {
    const stat =
      ' src/index.ts | 4 ++--\n .arbiter/evidence/tdd/1.json | 12 ++++++++++++\n 2 files changed, 14 insertions(+), 2 deletions(-)\n'
    expect(parseGitShowStatPaths(stat)).toEqual(['src/index.ts', '.arbiter/evidence/tdd/1.json'])
  })
})

describe('leadTimeHours / median / pct (#2398)', () => {
  it('computes hours between first commit and merge', () => {
    expect(leadTimeHours('2026-08-27T10:00:00Z', '2026-08-27T13:30:00Z')).toBe(3.5)
  })

  it('median of an odd-length array is the middle value', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('median of an even-length array averages the two middle values', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('median of an empty array is 0', () => {
    expect(median([])).toBe(0)
  })

  it('pct rounds to one decimal', () => {
    expect(pct(1, 3)).toBe(33.3)
  })

  it('pct(0, 0) is 0, never NaN', () => {
    expect(pct(0, 0)).toBe(0)
  })
})

describe('hasFailureConclusion / isStaleOpenPr (#2398)', () => {
  it('true when the rollup carries a FAILURE conclusion', () => {
    expect(hasFailureConclusion([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe(true)
  })

  it('false when the rollup has no FAILURE conclusion', () => {
    expect(hasFailureConclusion([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe(false)
  })

  it('false when the rollup is empty', () => {
    expect(hasFailureConclusion([])).toBe(false)
  })

  it('a red PR younger than 2h is not stale', () => {
    const pr = {
      createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      statusCheckRollup: [{ conclusion: 'FAILURE' }],
    }
    expect(isStaleOpenPr(pr, Date.now())).toBe(false)
  })

  it('a red PR older than 2h is stale', () => {
    const pr = {
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      statusCheckRollup: [{ conclusion: 'FAILURE' }],
    }
    expect(isStaleOpenPr(pr, Date.now())).toBe(true)
  })

  it('a green PR older than 2h is not stale', () => {
    const pr = {
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    }
    expect(isStaleOpenPr(pr, Date.now())).toBe(false)
  })
})

describe('classifyPrCommits / buildPrRow / computeAggregate (#2398)', () => {
  it('classifyPrCommits counts evidence-only and review-loop independently', () => {
    const commits = [
      { subject: 'feat(#1): add thing' },
      { subject: 'chore(#1): refresh evidence' },
      { subject: 'fix(#1): harden the bypass' },
    ]
    expect(classifyPrCommits(commits)).toEqual({ evidenceOnlyCount: 1, reviewLoopCount: 1 })
  })

  it('buildPrRow assembles a row from a PR + its commits', () => {
    const pr = {
      number: 42,
      mergedAt: '2026-08-27T13:00:00Z',
      additions: 10,
      deletions: 2,
      statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    }
    const commits = [{ subject: 'feat(#1): add thing', authoredDate: '2026-08-27T10:00:00Z' }]
    const row = buildPrRow(pr, commits)
    expect(row).toEqual({
      number: 42,
      mergedAt: '2026-08-27T13:00:00Z',
      commits: 1,
      evidenceOnlyCommits: 0,
      reviewLoopCommits: 0,
      leadTimeHours: 3,
      ciRedAtOpen: false,
      additions: 10,
      deletions: 2,
      issueIds: [],
      commitShas: [],
    })
  })

  it('computeAggregate rolls rows + issues + main log + open PRs into one summary', () => {
    const rows = [
      { commits: 4, evidenceOnlyCommits: 1, reviewLoopCommits: 2, leadTimeHours: 2 },
      { commits: 2, evidenceOnlyCommits: 0, reviewLoopCommits: 0, leadTimeHours: 6 },
    ]
    const aggregate = computeAggregate({
      rows,
      issuesClosedCount: 5,
      windowHours: 48,
      mainSubjects: ['feat(#1): a', 'chore(#1): refresh evidence'],
      openPrs: [
        {
          number: 99,
          createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          statusCheckRollup: [],
        },
      ],
      nowMs: Date.now(),
    })
    expect(aggregate).toEqual({
      prsMerged: 2,
      issuesClosed: 5,
      issuesPer24h: 2.5,
      medianCommitsPerPr: 3,
      medianLeadTimeHours: 4,
      pctEvidenceOnlyCommits: 16.7,
      pctReviewLoopCommits: 33.3,
      openPrsStale: [99],
      pctMainEvidenceOnlyCommits: 50,
    })
  })
})

describe('delivery cost classifiers (#2725)', () => {
  const eventAt = (seconds: number, kind: string) => ({
    t: new Date(Date.parse('2026-09-19T00:00:00Z') + seconds * 1000).toISOString(),
    kind,
  })

  const thresholds = {
    plateau: 1.3,
    tune: 1.2,
    rethinkMedian: 2,
    rethinkP90: 4,
    andon: 3,
  }

  const checkpoint = (overrides = {}) => ({
    n: 10,
    indices: {
      time: { median: 1.1, p90: 1.2 },
      tokens: { median: 1.1, p90: 1.2 },
    },
    buckets: {},
    maxOverhead: 1.2,
    escapes: [],
    ...overrides,
  })

  it('splits ordered event intervals into seconds without inventing zeroes', () => {
    expect(
      splitLeadTime([
        eventAt(0, 'work'),
        eventAt(10, 'verify'),
        eventAt(30, 'review'),
        eventAt(60, 'ciWait'),
        eventAt(100, 'rework'),
        eventAt(150, 'ceremony'),
        eventAt(210, 'done'),
      ]),
    ).toEqual({ work: 10, verify: 20, review: 30, ciWait: 40, rework: 50, ceremony: 60 })
  })

  it('returns null for unavailable or unknown lead-time segments', () => {
    expect(
      splitLeadTime([eventAt(0, 'work'), eventAt(10, 'mystery'), eventAt(20, 'done')]),
    ).toEqual({
      work: 10,
      verify: null,
      review: null,
      ciWait: null,
      rework: null,
      ceremony: null,
    })
  })

  it('aggregates session usage, skips malformed JSONL, and counts human messages', () => {
    expect(
      sessionUsage([
        JSON.stringify({ type: 'human', message: { content: 'start' } }),
        JSON.stringify({
          type: 'assistant',
          message: { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } },
        }),
        '{malformed',
        JSON.stringify({ type: 'human', message: { content: 'follow-up' } }),
        JSON.stringify({
          type: 'assistant',
          message: { usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 5 } },
        }),
      ]),
    ).toEqual({ input: 140, output: 30, cache: 35, humanMessages: 2 })
  })

  it('propagates no usage data as null fields', () => {
    expect(sessionUsage([JSON.stringify({ type: 'human' }), '{malformed'])).toEqual({
      input: null,
      output: null,
      cache: null,
      humanMessages: 1,
    })
  })

  it('uses treatment first, then the 200-LOC boundary for stratum fallback', () => {
    expect(stratumOf({ treatment: 'Standard', changedLoc: 1 })).toBe('Standard')
    expect(stratumOf({ treatment: 'XS-S', changedLoc: 1000 })).toBe('XS-S')
    expect(stratumOf({ changedLoc: 199 })).toBe('XS-S')
    expect(stratumOf({ changedLoc: 200 })).toBe('Standard')
  })

  it('always widens sensitive or train deliveries to Sensitive-train', () => {
    expect(stratumOf({ changedLoc: 1, sensitive: true })).toBe('Sensitive-train')
    expect(stratumOf({ changedLoc: 1, train: true })).toBe('Sensitive-train')
    expect(stratumOf({ treatment: 'XS-S', changedLoc: 1, sensitive: true })).toBe('Sensitive-train')
  })

  it('ignores nulls and preserves a heavy tail in quantiles', () => {
    expect(quantiles([1, null, 2, 3, 4, 5, 6, 7, 100, 100, 100])).toEqual({
      median: 5.5,
      p90: 100,
    })
  })

  it('returns null quantiles for an empty or all-null input', () => {
    expect(quantiles([])).toEqual({ median: null, p90: null })
    expect(quantiles([null, null])).toEqual({ median: null, p90: null })
  })

  it('weights fresh input, cached input, and output separately', () => {
    expect(
      costUnits({ input: 100, cache: 20, output: 10 }, { input: 1, cache: 0.1, output: 5 }),
    ).toBe(152)
    expect(costUnits({ input: 100 }, { input: 1, cache: 0.1, output: 5 })).toBe(100)
    expect(costUnits({ input: null, cache: null, output: null })).toBeNull()
  })

  it('computes separate time and token overhead indices from the stratum baseline', () => {
    const indices = overheadIndices(
      {
        stratum: 'Standard',
        sourcesKnown: ['ci', 'claude'],
        leadTime: 120,
        tokens: { input: 500, cache: 50, output: 0 },
        preflight: 10,
        fullGate: 20,
        review: 30,
        ci: 40,
      },
      { Standard: { timeMedian: 20, tokensMedian: 100, n: 30 } },
    )
    expect(indices).toMatchObject({ time: 2, tokens: 5.05 })
    expect(indices).toHaveProperty('floorComponents')
  })

  it('uses weighted costUnits for a delivery whose measured floor parts are zero', () => {
    const reference = 100
    expect(
      overheadIndices(
        {
          stratum: 'Standard',
          sourcesKnown: ['ci', 'claude'],
          preflight: 0,
          fullGate: 0,
          review: 0,
          ci: 0,
          tokens: { input: 0, cache: 0, output: 20 },
        },
        { Standard: { timeMedian: 1, tokensMedian: reference, n: 30 } },
        { input: 1, cache: 0.1, output: 5 },
      ),
    ).toMatchObject({ tokens: 1 })
  })

  it('returns null only for the overhead index whose source is missing', () => {
    const delivery = { stratum: 'Standard', leadTime: 120, tokens: { input: 600 } }
    const baseline = { Standard: { timeMedian: 20, tokensMedian: 100, n: 30 } }
    expect(overheadIndices({ ...delivery, tokens: undefined }, baseline)).toEqual({
      time: null,
      tokens: null,
    })
    expect(overheadIndices({ ...delivery, leadTime: undefined }, baseline)).toEqual({
      time: null,
      tokens: 6,
    })
    expect(overheadIndices(delivery, {})).toEqual({ time: null, tokens: null })
  })

  it('calibrates each stratum from only its first 30 deliveries', () => {
    const xsSmall = Array.from({ length: 31 }, (_, i) => ({
      stratum: 'XS-S',
      time: i + 1,
      tokens: { input: (i + 1) * 2 },
    }))
    expect(
      calibrate([
        ...xsSmall,
        { stratum: 'Standard', time: 40, tokens: { input: 80 } },
        { stratum: 'Standard', time: 60, tokens: { input: 120 } },
      ]),
    ).toEqual({
      'XS-S': { timeMedian: 15.5, tokensMedian: 31, n: 30 },
      Standard: { timeMedian: 50, tokensMedian: 100, n: 2 },
    })
  })

  it('returns PLATEAU only when current and previous checkpoints are within 1.3', () => {
    const current = checkpoint({
      indices: {
        time: { median: 1.3, p90: 1.3 },
        tokens: { median: 1.3, p90: 1.3 },
      },
    })
    const previous = checkpoint({
      indices: {
        time: { median: 1.3, p90: 1.3 },
        tokens: { median: 1.3, p90: 1.3 },
      },
    })
    expect(checkpointVerdict({ current, previous, baseline: {}, thresholds, history: [] })).toBe(
      'PLATEAU',
    )
  })

  it('returns HOLD when only the current checkpoint is within thresholds', () => {
    const current = checkpoint({
      indices: {
        time: { median: 1.3, p90: 1.3 },
        tokens: { median: 1.3, p90: 1.3 },
      },
    })
    const previous = checkpoint({
      indices: {
        time: { median: 1.4, p90: 1.4 },
        tokens: { median: 1.4, p90: 1.4 },
      },
    })
    expect(
      checkpointVerdict({
        current,
        previous,
        baseline: {},
        thresholds,
        history: [],
      }),
    ).toBe('HOLD')
  })

  it('returns HOLD for an out-of-plateau checkpoint below rethink without a bucket', () => {
    expect(
      checkpointVerdict({
        current: checkpoint({
          indices: {
            time: { median: 1.6, p90: 1.6 },
            tokens: { median: 1.1, p90: 1.2 },
          },
        }),
        previous: checkpoint(),
        baseline: {},
        thresholds,
        history: [],
      }),
    ).toBe('HOLD')
  })

  it('requires both indices to cross +20% coherently before tuning a bucket', () => {
    const base = { buckets: { review: { time: 100, tokens: 100 } } }
    const exact = checkpoint({
      buckets: { review: { time: 120, tokens: 120 } },
      topBucket: 'review',
    })
    expect(
      checkpointVerdict({
        current: exact,
        previous: checkpoint(),
        baseline: base,
        thresholds,
        history: [],
      }),
    ).toBe('PLATEAU')

    const incoherent = checkpoint({ buckets: { review: { time: 121, tokens: 119 } } })
    expect(
      checkpointVerdict({
        current: incoherent,
        previous: checkpoint(),
        baseline: base,
        thresholds,
        history: [],
      }),
    ).toBe('PLATEAU')
  })

  it('returns NO DATA for fewer than 10 deliveries before trend verdicts', () => {
    expect(
      checkpointVerdict({
        current: checkpoint({
          n: 9,
        }),
        previous: checkpoint(),
        baseline: {},
        thresholds,
        history: ['TUNE review', 'TUNE review'],
      }),
    ).toBe('NO DATA')
  })

  it('returns RETHINK above 2 median or 4 p90 after two ineffective TUNEs without a bucket', () => {
    const base = {
      current: checkpoint({
        indices: {
          time: { median: 2, p90: 4 },
          tokens: { median: 2, p90: 4 },
        },
      }),
      previous: checkpoint(),
      baseline: {},
      thresholds,
      history: ['TUNE review', 'TUNE review'],
    }
    expect(checkpointVerdict(base)).toBe('HOLD')
    expect(
      checkpointVerdict({
        ...base,
        current: {
          ...base.current,
          indices: {
            time: { median: 2.01, p90: 4 },
            tokens: { median: 2, p90: 4.01 },
          },
        },
      }),
    ).toBe('RETHINK')
  })

  it('uses ROLLBACK before ANDON for rollback escapes and strict overhead escapes', () => {
    const common = {
      previous: checkpoint(),
      baseline: {},
      thresholds,
      history: [],
    }
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ maxOverhead: 3, rollback: 'review' }),
      }),
    ).toBe('ROLLBACK')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ maxOverhead: 3.01, rollback: 'review' }),
      }),
    ).toBe('ROLLBACK')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ maxOverhead: 3.01 }),
      }),
    ).toBe('ANDON')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ maxOverhead: 3 }),
      }),
    ).toBe('PLATEAU')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ escapes: ['unfixed-regression'] }),
      }),
    ).toBe('ANDON')
  })

  it('keeps escape and rollback signals out of the NO DATA branch', () => {
    const common = {
      previous: checkpoint(),
      baseline: {},
      thresholds,
      history: [],
    }
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ n: 3, escapes: ['x'] }),
      }),
    ).toBe('ANDON')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ n: 3, rollback: 'review' }),
      }),
    ).toBe('ROLLBACK')
  })

  it('returns NO DATA when either index median is null at the checkpoint minimum', () => {
    expect(
      checkpointVerdict({
        current: checkpoint({
          indices: {
            time: { median: null, p90: 1.2 },
            tokens: { median: 1.1, p90: 1.2 },
          },
        }),
        previous: checkpoint(),
        baseline: {},
        thresholds,
        history: [],
      }),
    ).toBe('NO DATA')
  })

  it('formats one deterministic markdown checkpoint block with all AC-5 fields', () => {
    const result = {
      date: '2026-09-19',
      window: { since: '2026-09-01', until: '2026-09-19' },
      n: 10,
      indices: {
        time: { median: 1.2, p90: 1.8 },
        tokens: { median: 1.1, p90: 1.6 },
      },
      topBucket: 'review',
      verdict: 'HOLD',
    }
    const entry = formatLogEntry(result)
    expect(entry).toBe(formatLogEntry(result))
    expect(entry).toContain('2026-09-19')
    expect(entry).toContain('2026-09-01')
    expect(entry).toContain('2026-09-19')
    expect(entry).toContain('n: 10')
    expect(entry).toContain('time')
    expect(entry).toContain('tokens')
    expect(entry).toContain('review')
    expect(entry).toContain('HOLD')
    expect(entry.trim().split('\n').length).toBeGreaterThanOrEqual(5)
  })

  it('formats checkpoint identity, rounded numbers, and actionable ANDON details', () => {
    const entry = formatLogEntry({
      date: '2026-09-19',
      stratum: 'Standard',
      window: { since: '2026-09-01', until: '2026-09-19' },
      n: 10,
      indices: {
        time: { median: 1.6400000000000001, p90: 17.98 },
        tokens: { median: 0.03, p90: 0.04 },
      },
      topBucket: null,
      verdict: 'ANDON',
      offenders: [
        { number: 42, time: 3.456, tokens: 4.567 },
        { number: 7, time: 2, tokens: 1 },
      ],
      escapes: [
        {
          pr: 42,
          sha: 'abcdef123',
          kind: 'revert',
          subject: 'Revert "Merge pull request #42"',
        },
      ],
      escapeWindowOpen: 1,
    })
    expect(entry).toContain('- stratum: Standard')
    expect(entry).toContain('median=1.64, p90=17.98')
    expect(entry).toContain('median=0.03, p90=0.04')
    expect(entry).toContain(
      '- offenders: #42 overhead_time=3.46 overhead_tokens=4.57; #7 overhead_time=2 overhead_tokens=1',
    )
    expect(entry).toContain('- escape window open: 1')
    expect(entry).toContain('- escapes: #42 ← abcdef1 revert: Revert "Merge pull request #42"')
  })
})

describe('checkpoint history selection (#2725 checkpoint fixes)', () => {
  it('deduplicates by PR using the newest snapshot, sorts by mergedAt, and reports the worst PR', () => {
    const root = mkdtempSync(join(tmpdir(), 'ship-kpi-checkpoint-'))
    try {
      mkdirSync(join(root, '.arbiter/evidence/kpi'), { recursive: true })
      mkdirSync(join(root, 'scripts/data'), { recursive: true })
      mkdirSync(join(root, 'docs/internal/SYSTEM'), { recursive: true })
      writeFileSync(
        join(root, 'scripts/data/ship-kpi-baseline.json'),
        JSON.stringify({ Standard: { timeMedian: 100, tokensMedian: 100, n: 30 } }),
      )
      writeFileSync(
        join(root, 'scripts/data/ship-kpi-thresholds.json'),
        JSON.stringify({ n: 10, andon: 3, costWeights: { input: 1, cache: 0.1, output: 5 } }),
      )
      const normal = (number: number, mergedAt: string) => ({
        number,
        mergedAt,
        stratum: 'Standard',
        leadTimeSplit: { work: 100 },
        tokens: { input: 100, cache: 0, output: 0 },
      })
      writeFileSync(
        join(root, '.arbiter/evidence/kpi/2026-09-18.json'),
        JSON.stringify({
          rows: [
            ...Array.from({ length: 8 }, (_, index) =>
              normal(index + 1, `2026-09-0${index + 1}T00:00:00Z`),
            ),
            { stratum: 'Standard', leadTimeSplit: { work: 100 }, tokens: { input: 100 } },
          ],
        }),
      )
      writeFileSync(
        join(root, '.arbiter/evidence/kpi/2026-09-19.json'),
        JSON.stringify({
          rows: [
            normal(1, '2026-09-18T00:00:00Z'),
            {
              ...normal(9, '2026-09-19T00:00:00Z'),
              leadTimeSplit: { work: 400 },
              tokens: { input: 0, cache: 0, output: 80 },
              ciRedAtOpen: true,
            },
          ],
        }),
      )

      const result = spawnSync(
        'node',
        [join(process.cwd(), 'scripts/ship-kpi.mjs'), '--checkpoint'],
        {
          cwd: root,
          encoding: 'utf-8',
          env: { ...process.env, SHIP_KPI_NOW: '2026-10-01T00:00:00Z' },
        },
      )
      expect(result.status, `stderr:\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain('Standard: ANDON')
      expect(result.stdout).toContain('worst PR #9')
      const log = readFileSync(join(root, 'docs/internal/SYSTEM/SHIP_TUNING_LOG.md'), 'utf-8')
      expect(log).toContain('- stratum: Standard')
      expect(log).toContain('- Window: 2026-09-02 → 2026-09-19')
      expect(log).toContain('- offenders: #9 overhead_time=4 overhead_tokens=4')
      expect(log).toContain('- escape window open: 2')
      expect(log).toContain('- escapes: none')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('real delivery data sources (#2725 increment 2)', () => {
  const createdAt = '2026-09-19T00:00:00Z'
  const mergedAt = '2026-09-19T00:10:00Z'
  const firstCommit = '2026-09-19T00:01:00Z'
  const worktreeDir = '/home/luca/work/repos/arbiter.worktrees/2725-ship-kpi-loop'

  it('extracts sorted unique issue ids from the PR branch and closing references', () => {
    expect(typeof issueIdsOf).toBe('function')
    if (typeof issueIdsOf !== 'function') return
    expect(
      issueIdsOf({
        headRefName: '2703-fix/2704-follow-up/12703-not-this',
        closingIssuesReferences: [{ number: 2704 }, { number: 2705 }, { number: 2703 }],
      }),
    ).toEqual([2703, 2704, 2705, 12703])
  })

  it('derives CI wait, run, and red counts from completed pre-merge checks only', () => {
    expect(
      ciTiming({
        createdAt,
        mergedAt,
        statusCheckRollup: [
          {
            name: 'lint',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            startedAt: '2026-09-19T00:02:00Z',
            completedAt: '2026-09-19T00:04:00Z',
          },
          {
            name: 'tests',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
            startedAt: '2026-09-19T00:05:00Z',
            completedAt: '2026-09-19T00:07:00Z',
          },
          {
            name: 'cancelled notify',
            status: 'COMPLETED',
            conclusion: 'CANCELLED',
            startedAt: '2026-09-19T00:10:30Z',
            completedAt: '2026-09-19T00:11:00Z',
          },
          {
            name: 'still running',
            status: 'IN_PROGRESS',
            conclusion: null,
            startedAt: '2026-09-19T00:01:30Z',
            completedAt: null,
          },
        ],
      }),
    ).toEqual({ ciWaitSec: 120, ciRunSec: 300, redCiRuns: 1 })
  })

  it('keeps CI measures null when the rollup is absent, empty, or has no completed checks', () => {
    const expected = { ciWaitSec: null, ciRunSec: null, redCiRuns: null }
    expect(ciTiming({ createdAt, mergedAt })).toEqual(expected)
    expect(ciTiming({ createdAt, mergedAt, statusCheckRollup: [] })).toEqual(expected)
    expect(
      ciTiming({
        createdAt,
        mergedAt,
        statusCheckRollup: [
          {
            status: 'IN_PROGRESS',
            conclusion: null,
            startedAt: '2026-09-19T00:02:00Z',
            completedAt: null,
          },
        ],
      }),
    ).toEqual(expected)
  })

  it('attributes sessions by delimited branch or cwd issue ids and returns the match path', () => {
    const sessions = [
      {
        file: 'claude-branch',
        gitBranch: 'task/#2725-ship-kpi-loop',
        cwd: '/other',
        firstTs: firstCommit,
        lastTs: mergedAt,
        host: 'claude',
      },
      {
        file: 'codex-cwd',
        gitBranch: null,
        cwd: '/other/2725-ship-kpi-loop',
        firstTs: firstCommit,
        lastTs: mergedAt,
        host: 'codex',
      },
      {
        file: 'digit-boundary',
        gitBranch: null,
        cwd: '/other/12725-ship-kpi-loop',
        firstTs: firstCommit,
        lastTs: mergedAt,
        host: 'codex',
      },
      {
        file: 'wrong-branch',
        gitBranch: 'task/other',
        cwd: '/other',
        firstTs: firstCommit,
        lastTs: mergedAt,
        host: 'claude',
      },
      {
        file: 'outside-window',
        gitBranch: 'task/#2725-ship-kpi-loop',
        cwd: '/other',
        firstTs: '2026-09-18T21:00:00Z',
        lastTs: '2026-09-18T21:59:00Z',
        host: 'codex',
      },
    ]
    expect(
      attributeSessions(sessions, {
        headRefName: 'task/#2725-ship-kpi-loop',
        firstCommit,
        mergedAt,
        worktreeDir,
      }),
    ).toEqual([
      { meta: sessions[0], via: 'branch' },
      { meta: sessions[1], via: 'cwd' },
    ])
  })

  it('attributes a main-rooted Claude session through one issue in its first prompt', () => {
    const meta = {
      file: 'claude-main',
      host: 'claude',
      gitBranch: 'main',
      cwd: '/home/luca/work/repos/arbiter',
      firstPrompt: 'Ship issue #2703 with the KPI changes',
      issueIdsInPrompt: [2703],
      firstTs: firstCommit,
      lastTs: mergedAt,
    }
    expect(
      attributeSessions([meta], {
        headRefName: '2703-ship-kpi-loop',
        firstCommit,
        mergedAt,
        worktreeDir,
      }),
    ).toEqual([{ meta, via: 'prompt' }])
  })

  it('does not attribute a coordinator Claude session whose prompt names multiple issues', () => {
    const meta = {
      file: 'claude-coordinator',
      host: 'claude',
      gitBranch: 'main',
      cwd: '/home/luca/work/repos/arbiter',
      firstPrompt: 'Ship #2703 and #2704',
      issueIdsInPrompt: [2703, 2704],
      firstTs: firstCommit,
      lastTs: mergedAt,
    }
    expect(
      attributeSessions([meta], {
        headRefName: '2703-ship-kpi-loop',
        firstCommit,
        mergedAt,
        worktreeDir,
      }),
    ).toEqual([])
  })

  it('attributes a Codex rollout through agent path and a two-level parent chain', () => {
    const root = {
      file: 'codex-root',
      host: 'codex',
      cwd: '/chatgpt/project',
      agentPath: '/root/2703_plan_review',
      threadId: 'root',
      parentThreadId: null,
      firstTs: firstCommit,
      lastTs: mergedAt,
    }
    const child = {
      file: 'codex-child',
      host: 'codex',
      cwd: '/chatgpt/project',
      agentPath: '/root/worker',
      threadId: 'child',
      parentThreadId: 'root',
      firstTs: firstCommit,
      lastTs: mergedAt,
    }
    const grandchild = {
      file: 'codex-grandchild',
      host: 'codex',
      cwd: '/chatgpt/project',
      agentPath: '/root/worker/deep',
      threadId: 'grandchild',
      parentThreadId: 'child',
      firstTs: firstCommit,
      lastTs: mergedAt,
    }
    expect(
      attributeSessions([root, child, grandchild], {
        headRefName: '2703-ship-kpi-loop',
        firstCommit,
        mergedAt,
        worktreeDir,
      }),
    ).toEqual([
      { meta: root, via: 'agent-path' },
      { meta: child, via: 'parent' },
      { meta: grandchild, via: 'parent' },
    ])
  })

  it('rejects a matching session outside the two-hour pre-commit window', () => {
    const meta = {
      file: 'too-early',
      host: 'claude',
      gitBranch: 'task/#2703-ship-kpi-loop',
      firstTs: '2026-09-18T21:00:00Z',
      lastTs: '2026-09-18T21:59:00Z',
    }
    expect(
      attributeSessions([meta], {
        headRefName: '2703-ship-kpi-loop',
        firstCommit,
        mergedAt,
        worktreeDir,
      }),
    ).toEqual([])
  })

  it('summarizes Claude usage without counting sidechains or tool-result arrays as human messages', () => {
    expect(
      claudeSessionMeta([
        JSON.stringify({
          type: 'user',
          cwd: worktreeDir,
          gitBranch: 'task/#2725-ship-kpi-loop',
          timestamp: firstCommit,
          isSidechain: false,
          message: { role: 'user', content: 'Ship issue #2725' },
        }),
        JSON.stringify({
          type: 'assistant',
          cwd: worktreeDir,
          gitBranch: 'task/#2725-ship-kpi-loop',
          timestamp: '2026-09-19T00:02:00Z',
          effort: 'low',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_result', content: 'not a human message' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 5,
            },
          },
        }),
        JSON.stringify({
          type: 'user',
          cwd: worktreeDir,
          gitBranch: 'task/#2725-ship-kpi-loop',
          timestamp: '2026-09-19T00:03:00Z',
          isSidechain: true,
          message: { role: 'user', content: 'delegated sidechain' },
        }),
        JSON.stringify({
          type: 'user',
          cwd: worktreeDir,
          gitBranch: 'task/#2725-ship-kpi-loop',
          timestamp: '2026-09-19T00:04:00Z',
          isSidechain: false,
          effort: 'high',
          message: { role: 'user', content: 'follow-up' },
        }),
        JSON.stringify({
          type: 'assistant',
          cwd: worktreeDir,
          gitBranch: 'task/#2725-ship-kpi-loop',
          timestamp: '2026-09-19T00:05:00Z',
          effort: 'high',
          message: {
            role: 'assistant',
            content: 'done',
            usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 2 },
          },
        }),
      ]),
    ).toEqual({
      gitBranch: 'task/#2725-ship-kpi-loop',
      cwd: worktreeDir,
      firstTs: firstCommit,
      lastTs: '2026-09-19T00:05:00Z',
      usage: { input: 140, output: 30, cache: 37 },
      humanMessages: 2,
      effort: 'high',
      firstPrompt: 'Ship issue #2725',
      issueIdsInPrompt: [2725],
    })
  })

  it('truncates the first Claude prompt to 400 characters before extracting prompt issue ids', () => {
    const prompt = '#2703 ' + 'x'.repeat(500)
    const meta = claudeSessionMeta([
      JSON.stringify({
        type: 'user',
        timestamp: firstCommit,
        message: { role: 'user', content: prompt },
      }),
    ]) as Record<string, unknown>
    expect(meta.firstPrompt).toBe(prompt.slice(0, 400))
    expect(meta.issueIdsInPrompt).toEqual([2703])
  })

  it('keeps Claude usage and human message count null when no user or assistant lines exist', () => {
    expect(
      claudeSessionMeta([
        JSON.stringify({ type: 'system', cwd: worktreeDir, timestamp: firstCommit }),
      ]),
    ).toEqual({
      gitBranch: null,
      cwd: worktreeDir,
      firstTs: firstCommit,
      lastTs: firstCommit,
      usage: { input: null, output: null, cache: null },
      humanMessages: null,
      effort: null,
      firstPrompt: null,
      issueIdsInPrompt: [],
    })
  })

  it('takes the last Codex model, effort, and cumulative token usage snapshot', () => {
    expect(
      codexSessionMeta([
        JSON.stringify({
          type: 'session_meta',
          payload: {
            cwd: worktreeDir,
            timestamp: firstCommit,
            id: 'thread-2725',
            parent_thread_id: 'parent-thread',
            source: { subagent: { thread_spawn: { agent_path: '/root/2725_worker' } } },
          },
        }),
        JSON.stringify({
          type: 'turn_context',
          timestamp: '2026-09-19T00:02:00Z',
          payload: { model: 'gpt-5', effort: 'low' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-09-19T00:03:00Z',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 },
            },
          },
        }),
        JSON.stringify({
          type: 'turn_context',
          timestamp: '2026-09-19T00:04:00Z',
          payload: { model: 'gpt-5.4', reasoning_effort: 'high' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-09-19T00:05:00Z',
          payload: {
            info: {
              total_token_usage: { input_tokens: 160, cached_input_tokens: 40, output_tokens: 18 },
            },
          },
        }),
      ]),
    ).toEqual({
      cwd: worktreeDir,
      firstTs: firstCommit,
      lastTs: '2026-09-19T00:05:00Z',
      model: 'gpt-5.4',
      effort: 'high',
      agentPath: '/root/2725_worker',
      threadId: 'thread-2725',
      parentThreadId: 'parent-thread',
      usage: { input: 160, output: 18, cache: 40 },
    })
  })

  it('merges CI and attributed sessions while preserving measured zeroes and unknown nulls', () => {
    const row = {
      number: 2725,
      tokens: null,
      humanMessages: null,
      rounds: null,
      fullGateRuns: null,
      redCiRuns: null,
      leadTimeSplit: { work: 10, verify: null, review: null, ciWait: null },
    }
    expect(
      mergeDeliverySources(row, {
        ci: { ciWaitSec: 120, ciRunSec: 300, redCiRuns: 0 },
        sessions: [
          { host: 'claude', usage: { input: 100, output: 20, cache: 5 }, humanMessages: 2 },
          { host: 'claude', usage: { input: 40, output: 10, cache: null }, humanMessages: 1 },
          {
            host: 'codex',
            usage: { input: 160, output: 18, cache: 40 },
            model: 'gpt-5.4',
            effort: 'high',
          },
          {
            host: 'codex',
            usage: { input: 1, output: 2, cache: 3 },
            model: 'gpt-5.4',
            effort: 'high',
          },
        ],
      }),
    ).toMatchObject({
      number: 2725,
      tokens: { input: 301, output: 50, cache: 48 },
      humanMessages: 3,
      redCiRuns: 0,
      fullGateRuns: null,
      rounds: null,
      leadTimeSplit: { verify: 300, ciWait: 120 },
      models: ['gpt-5.4@high'],
      sourcesKnown: ['ci', 'claude', 'codex'],
    })

    expect(
      mergeDeliverySources(row, {
        ci: { ciWaitSec: null, ciRunSec: null, redCiRuns: null },
        sessions: [],
      }),
    ).toMatchObject({
      tokens: null,
      humanMessages: null,
      redCiRuns: null,
      fullGateRuns: null,
      rounds: null,
      sourcesKnown: [],
    })
  })

  it('sums unattributed tokens by host and excludes files attributed to deliveries', () => {
    expect(typeof unattributedUsage).toBe('function')
    if (typeof unattributedUsage !== 'function') return
    expect(
      unattributedUsage(
        [
          { file: 'claude-delivery', host: 'claude', usage: { input: 10, output: 2, cache: 3 } },
          {
            file: 'claude-orchestration',
            host: 'claude',
            usage: { input: 20, output: 3, cache: 2 },
          },
          { file: 'codex-orchestration', host: 'codex', usage: { input: 30, output: 4, cache: 6 } },
        ],
        new Set(['claude-delivery']),
      ),
    ).toEqual({ claude: 25, codex: 40, sessions: 2 })
  })

  it('skips Claude observer-session project directories during discovery', async () => {
    expect(typeof discoverSessions).toBe('function')
    if (typeof discoverSessions !== 'function') return
    const root = mkdtempSync(join(tmpdir(), 'ship-kpi-discovery-'))
    const sinceMs = Date.parse('2026-09-19T00:00:00Z')
    const untilMs = Date.parse('2026-09-19T00:20:00Z')
    try {
      const normal = join(root, 'normal-project')
      const observer = join(root, 'normal-project-observer-sessions')
      mkdirSync(normal, { recursive: true })
      mkdirSync(observer, { recursive: true })
      for (const file of [join(normal, 'normal.jsonl'), join(observer, 'observer.jsonl')]) {
        writeFileSync(
          file,
          JSON.stringify({ type: 'system', timestamp: '2026-09-19T00:05:00Z' }) + '\n',
        )
        utimesSync(file, new Date(sinceMs), new Date(sinceMs))
      }
      const sessions = (await discoverSessions(root, 'claude', sinceMs, untilMs)) as Array<{
        file: string
      }>
      expect(sessions.map((session) => session.file)).toEqual([join(normal, 'normal.jsonl')])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renders one orchestration line below the per-stratum table', () => {
    expect(typeof renderMarkdown).toBe('function')
    if (typeof renderMarkdown !== 'function') return
    const rendered = renderMarkdown({
      since: '2026-09-01',
      until: '2026-09-19',
      rows: [],
      aggregate: {
        prsMerged: 0,
        issuesClosed: 0,
        issuesPer24h: 0,
        medianCommitsPerPr: 0,
        medianLeadTimeHours: 0,
        pctEvidenceOnlyCommits: 0,
        pctReviewLoopCommits: 0,
        openPrsStale: [],
        pctMainEvidenceOnlyCommits: 0,
      },
      hookBlocks: {},
      unattributed: { claude: 100, codex: 200, sessions: 3 },
    })
    expect(rendered).toContain('unattributed: claude 100 / codex 200 across 3 sessions')
    expect(rendered.match(/^unattributed:/gm)).toHaveLength(1)
  })

  it('reports split token medians and compact weighted cost units per stratum', () => {
    const rendered = renderMarkdown({
      since: '2026-09-01',
      until: '2026-09-19',
      rows: [
        {
          stratum: 'Standard',
          leadTimeHours: 1,
          tokens: { input: 9_900_000, cache: 607_000, output: 60_700 },
          humanMessages: 1,
          sourcesKnown: ['ci', 'claude'],
        },
      ],
      aggregate: {
        prsMerged: 0,
        issuesClosed: 0,
        issuesPer24h: 0,
        medianCommitsPerPr: 0,
        medianLeadTimeHours: 0,
        pctEvidenceOnlyCommits: 0,
        pctReviewLoopCommits: 0,
        openPrsStale: [],
        pctMainEvidenceOnlyCommits: 0,
      },
      hookBlocks: {},
      unattributed: { claude: 0, codex: 0, sessions: 0 },
    })
    expect(rendered).toContain('| Median in / cache / out | Median costUnits |')
    expect(rendered).toContain('| Standard | 1 | 1/1 | 9.9M / 607k / 60.7k | 10.3M |')
  })

  it('requires the source needed by each overhead floor and reports measured/reference components', () => {
    const baseline = { Standard: { timeMedian: 20, tokensMedian: 100, n: 30 } }
    const measured = overheadIndices(
      {
        stratum: 'Standard',
        sourcesKnown: ['ci', 'claude'],
        tokens: { input: 600 },
        preflight: 10,
        fullGate: 20,
        review: 30,
        ci: 40,
      },
      baseline,
    ) as Record<string, unknown>
    expect(measured).toMatchObject({ time: 2, tokens: 6 })
    expect(measured.floorComponents).toEqual(
      expect.objectContaining({
        time: expect.objectContaining({
          measured: expect.anything(),
          reference: expect.anything(),
        }),
        tokens: expect.objectContaining({
          measured: expect.anything(),
          reference: expect.anything(),
        }),
      }),
    )

    expect(
      overheadIndices(
        {
          stratum: 'Standard',
          sourcesKnown: ['ci'],
          tokens: { input: 600 },
          preflight: 10,
          fullGate: 20,
          review: 30,
          ci: 40,
        },
        baseline,
      ),
    ).toMatchObject({ time: 2, tokens: null })
    expect(
      overheadIndices(
        {
          stratum: 'Standard',
          sourcesKnown: ['claude'],
          tokens: { input: 600 },
          preflight: 10,
          fullGate: 20,
          review: 30,
          ci: 40,
        },
        baseline,
      ),
    ).toMatchObject({ time: null, tokens: 6 })
  })
})

describe('ship-kpi.mjs --self-test (#2398, CANON-07 real execution)', () => {
  it('exits 0 and makes no `gh`/`git` calls', () => {
    const r = spawnSync('node', ['scripts/ship-kpi.mjs', '--self-test'], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: NODE_ONLY_PATH },
    })
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('PASS')
    expect(r.stdout).not.toMatch(/^FAIL /m)
  })

  it('prints usage and exits 2 when --since is missing', () => {
    const r = spawnSync('node', ['scripts/ship-kpi.mjs'], { encoding: 'utf-8' })
    expect(r.status).toBe(2)
    expect(r.stderr.toLowerCase()).toContain('usage')
    expect(r.stderr).toContain('HOLD')
  })
})
