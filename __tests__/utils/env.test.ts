import { describe, it, expect } from 'vitest'
import { parseBooleanEnv } from '../../src/utils/env.js'

describe('parseBooleanEnv (W-9)', () => {
  for (const truthy of ['true', 'TRUE', '1', 'yes', 'YES', 'on', 'ON']) {
    it(`returns true for "${truthy}"`, () => {
      expect(parseBooleanEnv(truthy)).toBe(true)
    })
  }

  for (const falsy of ['false', 'FALSE', '0', 'no', 'NO', 'off', 'OFF']) {
    it(`returns false for "${falsy}"`, () => {
      expect(parseBooleanEnv(falsy)).toBe(false)
    })
  }

  it('trims whitespace before evaluating', () => {
    expect(parseBooleanEnv('  true  ')).toBe(true)
    expect(parseBooleanEnv('\tfalse\n')).toBe(false)
  })

  it('returns undefined for ambiguous values', () => {
    expect(parseBooleanEnv('')).toBeUndefined()
    expect(parseBooleanEnv('maybe')).toBeUndefined()
    expect(parseBooleanEnv('2')).toBeUndefined()
  })

  it('returns undefined when input is undefined', () => {
    expect(parseBooleanEnv(undefined)).toBeUndefined()
  })
})
