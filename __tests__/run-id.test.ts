// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'

describe('run-id utils', () => {
  beforeEach(() => {
    delete process.env['ARBITER_RUN_ID']
  })

  it('getRunId mints an id matching arb-YYYYMMDD-HHMMSS-<8hex>', async () => {
    const { getRunId } = await import('../src/utils/run-id.js')
    const id = getRunId()
    expect(id).toMatch(/^arb-\d{8}-\d{6}-[0-9a-f]{8}$/)
  })

  it('getRunId returns same value within process (memoised via env)', async () => {
    const { getRunId } = await import('../src/utils/run-id.js')
    const a = getRunId()
    const b = getRunId()
    expect(a).toBe(b)
  })

  it('getRunId reads pre-set ARBITER_RUN_ID', async () => {
    process.env['ARBITER_RUN_ID'] = 'arb-20260516-120000-aabbccdd'
    const { getRunId } = await import('../src/utils/run-id.js')
    expect(getRunId()).toBe('arb-20260516-120000-aabbccdd')
  })

  it('formatRunIdFooter includes the run id', async () => {
    process.env['ARBITER_RUN_ID'] = 'arb-20260516-120000-aabbccdd'
    const { formatRunIdFooter } = await import('../src/utils/run-id.js')
    expect(formatRunIdFooter()).toContain('arb-20260516-120000-aabbccdd')
  })

  it('mintId produces correct format for given prefix', async () => {
    const { mintId } = await import('../src/utils/run-id.js')
    const id = mintId('bridge')
    expect(id).toMatch(/^bridge-\d{8}-\d{6}-[0-9a-f]{4}$/)
  })
})
