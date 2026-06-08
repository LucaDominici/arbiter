// SPDX-License-Identifier: Apache-2.0
//
// #1263 — pure batch core: multi-issue loop + per-issue STOP isolation + report
// aggregation. No I/O, no live LLM — the per-issue runner is injected/stubbed.
import { describe, it, expect } from 'vitest'
import {
  runBatch,
  formatBatchLines,
  type IssueRunner,
  type IssueOutcome,
} from '../../src/batch/batch.js'

const DATE = '2026-06-08'

/** A runner that ships every issue, deriving a deterministic branch/sha. */
const allGreen: IssueRunner = (id) => ({
  issueId: id,
  outcome: 'shipped',
  branch: `task/${id}-x`,
  sha: `sha-${id}`,
})

describe('runBatch — multi-issue loop', () => {
  it('processes every issue in the given order', () => {
    const report = runBatch(['#1', '#2', '#3'], { runIssue: allGreen, date: DATE })
    expect(report.issues.map((i) => i.issueId)).toEqual(['#1', '#2', '#3'])
  })

  it('records the injected date and an accurate count partition', () => {
    const report = runBatch(['#1', '#2'], { runIssue: allGreen, date: DATE })
    expect(report.date).toBe(DATE)
    expect(report.total).toBe(2)
    expect(report.succeeded).toBe(2)
    expect(report.blocked).toBe(0)
    expect(report.total).toBe(report.succeeded + report.blocked)
  })

  it('carries per-issue branch + sha from the runner into the report', () => {
    const report = runBatch(['#42'], { runIssue: allGreen, date: DATE })
    expect(report.issues[0]).toMatchObject({
      issueId: '#42',
      outcome: 'shipped',
      branch: 'task/#42-x',
      sha: 'sha-#42',
    })
  })

  it('handles an empty issue set without crashing', () => {
    const report = runBatch([], { runIssue: allGreen, date: DATE })
    expect(report.total).toBe(0)
    expect(report.issues).toEqual([])
  })
})

describe('runBatch — per-issue STOP isolation (the crux)', () => {
  it('a throw on a middle issue does NOT abort the batch; the loop continues', () => {
    const runner: IssueRunner = (id) => {
      if (id === '#B') throw new Error('gate red on #B')
      return { issueId: id, outcome: 'shipped', branch: `task/${id}`, sha: `sha-${id}` }
    }
    const report = runBatch(['#A', '#B', '#C'], { runIssue: runner, date: DATE })

    // All three issues are present and the loop completed.
    expect(report.issues.map((i) => i.issueId)).toEqual(['#A', '#B', '#C'])
    expect(report.total).toBe(3)

    const byId = (id: string): IssueOutcome =>
      report.issues.find((i) => i.issueId === id) as IssueOutcome
    expect(byId('#A').outcome).toBe('shipped')
    expect(byId('#C').outcome).toBe('shipped')

    // The failing issue is isolated as blocked, with the blocker message preserved.
    expect(byId('#B').outcome).toBe('blocked')
    expect(byId('#B').blocker).toMatch(/gate red on #B/)
  })

  it('counts reflect the success/blocked partition after a mid-batch failure', () => {
    const runner: IssueRunner = (id) => {
      if (id === '#B') throw new Error('boom')
      return { issueId: id, outcome: 'shipped' }
    }
    const report = runBatch(['#A', '#B', '#C'], { runIssue: runner, date: DATE })
    expect(report.succeeded).toBe(2)
    expect(report.blocked).toBe(1)
    expect(report.total).toBe(report.succeeded + report.blocked)
  })

  it('a runner that returns a blocked outcome (no throw) is also counted as blocked', () => {
    const runner: IssueRunner = (id) =>
      id === '#B'
        ? { issueId: id, outcome: 'blocked', blocker: 'explicit block' }
        : { issueId: id, outcome: 'shipped' }
    const report = runBatch(['#A', '#B'], { runIssue: runner, date: DATE })
    expect(report.blocked).toBe(1)
    expect(report.issues.find((i) => i.issueId === '#B')?.blocker).toBe('explicit block')
  })

  it('a non-Error throw is coerced to a string blocker (never loses the issue)', () => {
    const runner: IssueRunner = (id) => {
      if (id === '#B') throw 'raw string failure'
      return { issueId: id, outcome: 'shipped' }
    }
    const report = runBatch(['#A', '#B', '#C'], { runIssue: runner, date: DATE })
    expect(report.issues).toHaveLength(3)
    expect(report.issues.find((i) => i.issueId === '#B')?.blocker).toMatch(/raw string failure/)
  })
})

describe('formatBatchLines', () => {
  it('always emits a header line with the totals', () => {
    const report = runBatch(['#1', '#2'], { runIssue: allGreen, date: DATE })
    const lines = formatBatchLines(report)
    expect(lines.some((l) => /batch/i.test(l) && /2/.test(l))).toBe(true)
  })

  it('flags blocked issues in the summary', () => {
    const runner: IssueRunner = (id) =>
      id === '#B'
        ? { issueId: id, outcome: 'blocked', blocker: 'gate red' }
        : { issueId: id, outcome: 'shipped' }
    const lines = formatBatchLines(runBatch(['#A', '#B'], { runIssue: runner, date: DATE }))
    expect(lines.some((l) => /#B/.test(l) && /block/i.test(l))).toBe(true)
  })
})
