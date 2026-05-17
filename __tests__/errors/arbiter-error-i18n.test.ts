// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { ArbiterError } from '../../src/utils/errors.js'
import { resetForTest } from '../../src/i18n/index.js'

describe('ArbiterError.fromKey() (#658)', () => {
  beforeEach(() => {
    resetForTest()
  })

  it('produces an ArbiterError with the given code', () => {
    const err = ArbiterError.fromKey('E_CONFIG_NOT_FOUND', 'errors.E_CONFIG_NOT_FOUND')
    expect(err).toBeInstanceOf(ArbiterError)
    expect(err.code).toBe('E_CONFIG_NOT_FOUND')
  })

  it('message comes from en.json catalog', () => {
    const err = ArbiterError.fromKey('E_CONFIG_NOT_FOUND', 'errors.E_CONFIG_NOT_FOUND')
    expect(err.message).toContain('arbiter init')
  })

  it('interpolates params into message', () => {
    const err = ArbiterError.fromKey('E_UPGRADE_UNKNOWN_LEVEL', 'errors.E_UPGRADE_UNKNOWN_LEVEL', {
      level: 'galaxy-brain',
    })
    expect(err.message).toBe('Unknown governance level: galaxy-brain')
  })

  it('code is stable regardless of locale (i18n contract)', () => {
    const err1 = ArbiterError.fromKey('E_CONFIG_NOT_FOUND', 'errors.E_CONFIG_NOT_FOUND')
    const err2 = ArbiterError.fromKey('E_CONFIG_NOT_FOUND', 'errors.E_CONFIG_NOT_FOUND')
    expect(err1.code).toBe(err2.code)
  })

  it('passes hint and docUrl through opts', () => {
    const err = ArbiterError.fromKey(
      'E_CONFIG_NOT_FOUND',
      'errors.E_CONFIG_NOT_FOUND',
      {},
      { hint: 'check docs', docUrl: 'https://example.com' },
    )
    expect(err.hint).toBe('check docs')
    expect(err.docUrl).toBe('https://example.com')
  })

  it('missing key falls back to key string as message', () => {
    const err = ArbiterError.fromKey('E_UNKNOWN_XYZ', 'errors.E_UNKNOWN_XYZ')
    expect(err.message).toBe('errors.E_UNKNOWN_XYZ')
  })

  it('name is ArbiterError', () => {
    const err = ArbiterError.fromKey('E_CONFIG_NOT_FOUND', 'errors.E_CONFIG_NOT_FOUND')
    expect(err.name).toBe('ArbiterError')
  })
})
