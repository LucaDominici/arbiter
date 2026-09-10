// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { evaluateMerged } from '../../src/commands/pr-merged'

describe('completion policy qualification (#2638)', () => {
  const candidate = 'a'.repeat(40)
  const reviewedPr = {
    number: 7,
    state: 'MERGED',
    baseRefName: 'main',
    headRefOid: candidate,
    mergeCommit: { oid: 'b'.repeat(40) },
    mergedAt: '2026-09-10T08:00:00Z',
    statusCheckRollup: [
      {
        conclusion: 'SUCCESS',
        completedAt: '2026-09-10T07:59:00Z',
        checkSuite: { createdAt: '2026-09-10T07:58:00Z' },
      },
    ],
  }

  it('AC-2: accepts a qualified reviewed PR with a distinct merge commit', () => {
    expect(
      evaluateMerged([reviewedPr], 'task/#2638', undefined, candidate, {
        policy: 'reviewed-pr',
        mergeReachableFromMain: true,
        requireMainBase: true,
      }),
    ).toEqual({ merged: true, number: 7 })
  })

  it('AC-4: rejects the same candidate when the PR does not target main', () => {
    expect(
      evaluateMerged(
        [{ ...reviewedPr, baseRefName: 'release' }],
        'task/#2638',
        undefined,
        candidate,
        {
          policy: 'reviewed-pr',
          mergeReachableFromMain: true,
          requireMainBase: true,
        },
      ),
    ).toMatchObject({ merged: false })
  })
})
