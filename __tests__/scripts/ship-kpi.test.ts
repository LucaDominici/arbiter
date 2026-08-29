// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/ship-kpi.test.ts
//
// #2398: throughput KPI script. Pure predicate unit tests (direct import, no
// `gh`/`git` calls) + a real spawn of --self-test (CANON-07: generated
// scripts must be executed in tests, not just string-matched).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
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
