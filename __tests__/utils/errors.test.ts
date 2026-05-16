import { describe, it, expect } from 'vitest'
import { UserFacingError } from '../../src/utils/errors.js'

describe('UserFacingError (#681)', () => {
  it('is an instance of Error', () => {
    const err = new UserFacingError('bad input')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "UserFacingError"', () => {
    const err = new UserFacingError('bad input')
    expect(err.name).toBe('UserFacingError')
  })

  it('exposes message', () => {
    const err = new UserFacingError('configuration missing')
    expect(err.message).toBe('configuration missing')
  })

  it('preserves instanceof check', () => {
    const err = new UserFacingError('oops')
    expect(err instanceof UserFacingError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it('a plain Error is not a UserFacingError', () => {
    const err = new Error('oops')
    expect(err instanceof UserFacingError).toBe(false)
  })
})
