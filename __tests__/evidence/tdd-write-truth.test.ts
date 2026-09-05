// SPDX-License-Identifier: Apache-2.0
//
// #2533: `writeTddEvidence` used to call `writeFile(...)` and discard the returned
// `WriteResult` entirely — a withheld write (e.g. the on-disk file carries the
// `arbiter:preserve` marker, or any future reason `writeFile` declines to land the
// bytes) was silently reported as success. This file isolates that write-truth
// contract with a mocked `writeFile` so the withheld/benign-skip branches are
// exercised deterministically, independent of what actually triggers `withheld` in
// `src/utils/fs.ts` today.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/fs.js')>()
  return {
    ...actual,
    writeFile: vi.fn(),
  }
})

import { writeFile, type WriteResult } from '../../src/utils/fs.js'
import { writeTddEvidence, type TddEvidence } from '../../src/evidence/tdd.js'

const mockWriteFile = vi.mocked(writeFile)

const VALID: TddEvidence = {
  $schemaVersion: 1,
  task_id: '#551',
  test_path: '__tests__/evidence/tdd.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL __tests__/evidence/tdd.test.ts',
  observed_failure: 'FAIL __tests__/evidence/tdd.test.ts',
  recorded_at: '2026-05-16T00:00:00.000Z',
}

describe('writeTddEvidence() — write-truth contract (#2533)', () => {
  beforeEach(() => {
    mockWriteFile.mockReset()
  })

  it('throws when the underlying write is withheld — content that did not land is never reported as success', () => {
    const withheldResult: WriteResult = {
      path: '/fake-repo/.arbiter/evidence/tdd/#551.json',
      action: 'skipped',
      withheld: true,
    }
    mockWriteFile.mockReturnValue(withheldResult)
    expect(() => writeTddEvidence({ repoDir: '/fake-repo', evidence: VALID })).toThrow(
      /withheld/i,
    )
  })

  it('does not throw when the write is a benign identical-content skip (withheld unset)', () => {
    const benignSkip: WriteResult = {
      path: '/fake-repo/.arbiter/evidence/tdd/#551.json',
      action: 'skipped',
    }
    mockWriteFile.mockReturnValue(benignSkip)
    expect(() => writeTddEvidence({ repoDir: '/fake-repo', evidence: VALID })).not.toThrow()
  })

  it('calls writeFile with skipPreserveCheck so evidence is never subject to the preserve marker', () => {
    mockWriteFile.mockReturnValue({
      path: '/fake-repo/.arbiter/evidence/tdd/#551.json',
      action: 'created',
    })
    writeTddEvidence({ repoDir: '/fake-repo', evidence: VALID })
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('#551.json'),
      expect.any(String),
      expect.objectContaining({ skipPreserveCheck: true }),
    )
  })
})
