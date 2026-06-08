// SPDX-License-Identifier: Apache-2.0
//
// #1263 — batch adapter: issue-list parsing, report path, file write, and the
// run-and-write composition. I/O is exercised against a tmp dir; no live LLM/gh.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseIssueList,
  batchReportPath,
  writeBatchReport,
  runShipBatch,
  defaultIssueRunner,
} from '../../src/batch/batch-runner.js'
import { runBatch, type IssueRunner } from '../../src/batch/batch.js'

describe('parseIssueList', () => {
  it('parses a comma-separated list to #-prefixed ids', () => {
    expect(parseIssueList('1,2,3')).toEqual(['#1', '#2', '#3'])
  })

  it('tolerates whitespace and leading # marks', () => {
    expect(parseIssueList(' #1 , 2 ,#3 ')).toEqual(['#1', '#2', '#3'])
  })

  it('rejects an empty list', () => {
    expect(() => parseIssueList('')).toThrow()
    expect(() => parseIssueList('  ')).toThrow()
  })

  it('rejects non-numeric ids', () => {
    expect(() => parseIssueList('1,abc,3')).toThrow()
  })

  it('rejects zero and negative ids', () => {
    expect(() => parseIssueList('0')).toThrow()
    expect(() => parseIssueList('1,-2')).toThrow()
  })
})

describe('batchReportPath', () => {
  it('builds a date-stamped report filename', () => {
    expect(batchReportPath('2026-06-08')).toBe('batch-report-2026-06-08.json')
  })
})

describe('writeBatchReport + runShipBatch (I/O)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'batch-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the report JSON to the date-stamped path under dir', () => {
    const stub: IssueRunner = (id) => ({ issueId: id, outcome: 'shipped', branch: `task/${id}` })
    const report = runBatch(['#1', '#2'], { runIssue: stub, date: '2026-06-08' })
    const path = writeBatchReport(dir, report)
    expect(existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    expect(parsed.total).toBe(2)
    expect(parsed.date).toBe('2026-06-08')
    expect(parsed.issues).toHaveLength(2)
  })

  it('runShipBatch runs the loop, writes the report, and returns summary lines', () => {
    const stub: IssueRunner = (id) =>
      id === '#2'
        ? { issueId: id, outcome: 'blocked', blocker: 'stub block' }
        : { issueId: id, outcome: 'shipped' }
    const { lines, reportPath, report } = runShipBatch(['#1', '#2'], { dir, runIssue: stub })

    expect(existsSync(reportPath)).toBe(true)
    expect(report.succeeded).toBe(1)
    expect(report.blocked).toBe(1)
    expect(lines.some((l) => /batch/i.test(l))).toBe(true)
  })

  it('the default (unwired) runner throws a clean-context-seam error', () => {
    expect(() => defaultIssueRunner('#7')).toThrow(/no per-issue runner wired for #7/)
  })

  it('runShipBatch with no runner reports every issue blocked (seam not wired)', () => {
    const { report } = runShipBatch(['#1', '#2'], { dir })
    expect(report.blocked).toBe(2)
    expect(report.succeeded).toBe(0)
    expect(report.issues.every((i) => /no per-issue runner wired/.test(i.blocker ?? ''))).toBe(true)
  })

  it('per-issue STOP isolation survives end-to-end through the adapter', () => {
    const stub: IssueRunner = (id) => {
      if (id === '#2') throw new Error('mid-batch throw')
      return { issueId: id, outcome: 'shipped' }
    }
    const { report, reportPath } = runShipBatch(['#1', '#2', '#3'], { dir, runIssue: stub })
    expect(report.issues).toHaveLength(3)
    expect(report.blocked).toBe(1)
    const onDisk = JSON.parse(readFileSync(reportPath, 'utf-8'))
    expect(onDisk.issues.find((i: { issueId: string }) => i.issueId === '#2').outcome).toBe(
      'blocked',
    )
  })
})
