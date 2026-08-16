// SPDX-License-Identifier: Apache-2.0
// #2282: the lock-holder fixture's margin invariant.
import { describe, it, expect } from 'vitest'
import { HOLDER_SECONDS, OBSERVE_BUDGET_MS, MIN_MARGIN_MS } from './lock-holder.js'

describe('lock-holder fixture margin (#2282)', () => {
  // The defect behind the whole flaky-under-load cluster is that the holder lived for
  // EXACTLY the observation budget, leaving zero slack for a late-scheduled probe. This
  // is the only assertion about that margin a loaded runner cannot flip: it spawns
  // nothing, waits for nothing, and reads no clock. The behavioural proof that a holder
  // really is observable lives in the two call-site tests.
  it('the holder outlives the observation window by at least MIN_MARGIN_MS', () => {
    expect(HOLDER_SECONDS * 1000).toBeGreaterThan(OBSERVE_BUDGET_MS + MIN_MARGIN_MS)
  })
})
