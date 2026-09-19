// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/ship-kpi.test.ts
//
// #2398: throughput KPI script. Pure predicate unit tests (direct import, no
// `gh`/`git` calls) + a real spawn of --self-test (CANON-07: generated
// scripts must be executed in tests, not just string-matched).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
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
} from '../../scripts/ship-kpi.mjs'

// #2725 is RED-only: these names are intentionally absent until the
// implementation stage. Namespace lookup lets the pre-existing tests in this
// file continue to run and fails the new cases on the missing export itself.
const splitLeadTime = Reflect.get(shipKpi, 'splitLeadTime') as (...args: unknown[]) => unknown
const sessionUsage = Reflect.get(shipKpi, 'sessionUsage') as (...args: unknown[]) => unknown
const stratumOf = Reflect.get(shipKpi, 'stratumOf') as (...args: unknown[]) => unknown
const quantiles = Reflect.get(shipKpi, 'quantiles') as (...args: unknown[]) => unknown
const overheadIndices = Reflect.get(shipKpi, 'overheadIndices') as (...args: unknown[]) => unknown
const calibrate = Reflect.get(shipKpi, 'calibrate') as (...args: unknown[]) => unknown
const checkpointVerdict = Reflect.get(shipKpi, 'checkpointVerdict') as (
  ...args: unknown[]
) => unknown
const formatLogEntry = Reflect.get(shipKpi, 'formatLogEntry') as (...args: unknown[]) => unknown

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
      commits: 1,
      evidenceOnlyCommits: 0,
      reviewLoopCommits: 0,
      leadTimeHours: 3,
      ciRedAtOpen: false,
      additions: 10,
      deletions: 2,
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

describe('delivery cost classifiers (#2725, RED)', () => {
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

  it('computes separate time and token overhead indices from the stratum baseline', () => {
    expect(
      overheadIndices(
        {
          stratum: 'Standard',
          leadTime: 120,
          tokens: 600,
          preflight: 10,
          fullGate: 20,
          review: 30,
          ci: 40,
        },
        { Standard: { timeMedian: 20, tokensMedian: 100, n: 30 } },
      ),
    ).toEqual({ time: 2, tokens: 6 })
  })

  it('returns null only for the overhead index whose source is missing', () => {
    const delivery = { stratum: 'Standard', leadTime: 120, tokens: 600 }
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
      tokens: (i + 1) * 2,
    }))
    expect(
      calibrate([
        ...xsSmall,
        { stratum: 'Standard', time: 40, tokens: 80 },
        { stratum: 'Standard', time: 60, tokens: 120 },
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

  it('does not call a single within-threshold checkpoint PLATEAU', () => {
    const current = checkpoint({
      buckets: { review: { time: 121, tokens: 121 } },
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
        baseline: { buckets: { review: { time: 100, tokens: 100 } } },
        thresholds,
        history: [],
      }),
    ).toBe('TUNE review')
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
          maxOverhead: 10,
          buckets: { review: { time: 200, tokens: 200 } },
        }),
        previous: checkpoint(),
        baseline: { buckets: { review: { time: 100, tokens: 100 } } },
        thresholds,
        history: ['TUNE review', 'TUNE review'],
      }),
    ).toBe('NO DATA')
  })

  it('returns RETHINK only above 2 median or 4 p90 after two ineffective TUNEs', () => {
    const base = {
      current: checkpoint({
        indices: {
          time: { median: 2, p90: 4 },
          tokens: { median: 2, p90: 4 },
        },
        buckets: { review: { time: 121, tokens: 121 } },
      }),
      previous: checkpoint(),
      baseline: { buckets: { review: { time: 100, tokens: 100 } } },
      thresholds,
      history: ['TUNE review', 'TUNE review'],
    }
    expect(checkpointVerdict(base)).toBe('TUNE review')
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

  it('uses ANDON for an escape or a delivery strictly over 3x, ahead of ROLLBACK', () => {
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
    ).toBe('ANDON')
    expect(
      checkpointVerdict({
        ...common,
        current: checkpoint({ escapes: ['unfixed-regression'] }),
      }),
    ).toBe('ANDON')
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
      verdict: 'PLATEAU',
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
    expect(entry).toContain('PLATEAU')
    expect(entry.trim().split('\n').length).toBeGreaterThanOrEqual(5)
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
  })
})
