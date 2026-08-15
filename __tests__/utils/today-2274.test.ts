// #2274 — emitted `today` must honor SOURCE_DATE_EPOCH so committed generated
// trees (examples/) do not roll every calendar day and red the examples-drift gate.
import { describe, expect, it } from 'vitest'
import { isoToday } from '../../src/utils/today.js'

describe('#2274 isoToday honors SOURCE_DATE_EPOCH', () => {
  it('pins to the epoch when set', () => {
    expect(isoToday({ SOURCE_DATE_EPOCH: '1786233600' })).toBe('2026-08-09')
  })
  it('falls back to the wall clock when unset', () => {
    expect(isoToday({})).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('ignores a malformed epoch', () => {
    expect(isoToday({ SOURCE_DATE_EPOCH: 'not-a-number' })).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
