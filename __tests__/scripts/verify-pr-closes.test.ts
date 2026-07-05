// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/verify-pr-closes.test.ts
// #1766: GitHub's closing-keyword parser only reliably auto-closes the FIRST issue in a
// comma-separated `Closes #N1, #N2, ...` PR body list on admin/rebase-merge. Tests the
// reference-list parser (parseCloseRefs) and the post-merge repair CLI (runCli), the
// latter with injected IO so no real `gh` call happens in tests.

import { describe, it, expect, vi } from 'vitest'
import { parseCloseRefs, runCli } from '../../scripts/verify-pr-closes.mjs'

describe('parseCloseRefs', () => {
  it('parses the exact comma-list body shape from PR #1764 (the bug reproduction)', () => {
    const body = '<issue→commit table>\n\nCloses #1740, #1749, #1766'
    expect(parseCloseRefs(body)).toEqual([1740, 1749, 1766])
  })

  it('parses canonical one-per-line Closes references', () => {
    const body = 'Some summary.\n\nCloses #10\nCloses #11\nCloses #12\n'
    expect(parseCloseRefs(body)).toEqual([10, 11, 12])
  })

  it('is case-insensitive on the closing keyword', () => {
    const body = 'fixes #5\nRESOLVED #6\nClose #7'
    expect(parseCloseRefs(body)).toEqual([5, 6, 7])
  })

  it('parses an "and"-joined list', () => {
    const body = 'Closes #1 and #2 and #3'
    expect(parseCloseRefs(body)).toEqual([1, 2, 3])
  })

  it('ignores bare #N mentions with no closing keyword', () => {
    const body = 'See #100 for context. Closes #200. Related to #300.'
    expect(parseCloseRefs(body)).toEqual([200])
  })

  it('dedupes repeated references to the same issue', () => {
    const body = 'Closes #1\nFixes #1\nResolves #2'
    expect(parseCloseRefs(body)).toEqual([1, 2])
  })

  it('returns an empty array for a body with no closing keywords', () => {
    expect(parseCloseRefs('Just a summary, no refs.')).toEqual([])
  })

  it('returns an empty array for empty/null body', () => {
    expect(parseCloseRefs('')).toEqual([])
    expect(parseCloseRefs(undefined as unknown as string)).toEqual([])
  })
})

describe('runCli', () => {
  it('returns 0 and reports nothing to do when there are no closing refs', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'no refs here' })),
      getIssueState: vi.fn(),
      closeIssue: vi.fn(),
    }
    const code = await runCli(1, io, false)
    expect(code).toBe(0)
    expect(io.getIssueState).not.toHaveBeenCalled()
  })

  it('returns 0 when all referenced issues are already closed', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'Closes #1\nCloses #2' })),
      getIssueState: vi.fn(() => ({ state: 'CLOSED' })),
      closeIssue: vi.fn(),
    }
    const code = await runCli(1764, io, false)
    expect(code).toBe(0)
    expect(io.closeIssue).not.toHaveBeenCalled()
  })

  it('dry-run: returns 1 and does not close stragglers, only reports them', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'Closes #1740, #1749, #1766' })),
      getIssueState: vi.fn((n: number) => ({ state: n === 1740 ? 'CLOSED' : 'OPEN' })),
      closeIssue: vi.fn(),
    }
    const code = await runCli(1764, io, true)
    expect(code).toBe(1)
    expect(io.closeIssue).not.toHaveBeenCalled()
  })

  it('non-dry-run: closes every straggler and returns 0', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'Closes #1740, #1749, #1766' })),
      getIssueState: vi.fn((n: number) => ({ state: n === 1740 ? 'CLOSED' : 'OPEN' })),
      closeIssue: vi.fn(() => ({ ok: true })),
    }
    const code = await runCli(1764, io, false)
    expect(code).toBe(0)
    expect(io.closeIssue).toHaveBeenCalledTimes(2)
    expect(io.closeIssue).toHaveBeenCalledWith(1749, expect.stringContaining('#1766'))
    expect(io.closeIssue).toHaveBeenCalledWith(1766, expect.stringContaining('#1766'))
  })

  it('returns 2 when fetching the PR body fails', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ error: 'gh pr view failed: not found' })),
      getIssueState: vi.fn(),
      closeIssue: vi.fn(),
    }
    const code = await runCli(9999, io, false)
    expect(code).toBe(2)
  })

  it('returns 2 when checking an issue state fails', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'Closes #1' })),
      getIssueState: vi.fn(() => ({ error: 'gh issue view failed' })),
      closeIssue: vi.fn(),
    }
    const code = await runCli(1, io, false)
    expect(code).toBe(2)
  })

  it('returns 2 when closing a straggler fails', async () => {
    const io = {
      getPrBody: vi.fn(() => ({ body: 'Closes #1' })),
      getIssueState: vi.fn(() => ({ state: 'OPEN' })),
      closeIssue: vi.fn(() => ({ error: 'gh issue close failed' })),
    }
    const code = await runCli(1, io, false)
    expect(code).toBe(2)
  })
})
