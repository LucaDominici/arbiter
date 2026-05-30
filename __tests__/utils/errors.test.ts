import { describe, it, expect } from 'vitest'
import {
  ArbiterError,
  UserFacingError,
  RecoverableError,
  FatalError,
  ConfigError,
} from '../../src/utils/errors.js'
import { ERROR_CATALOG } from '../../src/utils/error-catalog.js'

describe('ArbiterError (#547)', () => {
  it('is an instance of UserFacingError and Error', () => {
    const err = new ArbiterError('E_TEST', 'test message')
    expect(err).toBeInstanceOf(UserFacingError)
    expect(err).toBeInstanceOf(Error)
  })

  it('exposes code, message, and name', () => {
    const err = new ArbiterError('E_CONFIG_NOT_FOUND', 'No arbiter.json found.')
    expect(err.code).toBe('E_CONFIG_NOT_FOUND')
    expect(err.message).toBe('No arbiter.json found.')
    expect(err.name).toBe('ArbiterError')
  })

  it('exposes optional hint', () => {
    const err = new ArbiterError('E_CONFIG_NOT_FOUND', 'No arbiter.json found.', {
      hint: 'Run `arbiter init` to initialize governance.',
    })
    expect(err.hint).toBe('Run `arbiter init` to initialize governance.')
  })

  it('exposes optional docUrl', () => {
    const err = new ArbiterError('E_CONFIG_NOT_FOUND', 'No arbiter.json found.', {
      docUrl: 'https://arbiter.dev/reference/cli#init',
    })
    expect(err.docUrl).toBe('https://arbiter.dev/reference/cli#init')
  })

  it('hint and docUrl are undefined when not provided', () => {
    const err = new ArbiterError('E_TEST', 'msg')
    expect(err.hint).toBeUndefined()
    expect(err.docUrl).toBeUndefined()
  })
})

describe('ERROR_CATALOG (#547)', () => {
  it('contains at least 10 entries', () => {
    expect(ERROR_CATALOG.size).toBeGreaterThanOrEqual(10)
  })

  it('E_CONFIG_NOT_FOUND entry has required fields', () => {
    const entry = ERROR_CATALOG.get('E_CONFIG_NOT_FOUND')
    expect(entry).toBeDefined()
    expect(entry?.code).toBe('E_CONFIG_NOT_FOUND')
    expect(entry?.summary).toBeTruthy()
    expect(entry?.detail).toBeTruthy()
    expect(entry?.recovery).toBeTruthy()
  })

  it('every entry has non-empty code, summary, detail, recovery', () => {
    for (const [key, entry] of ERROR_CATALOG) {
      expect(entry.code).toBe(key)
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.detail.length).toBeGreaterThan(0)
      expect(entry.recovery.length).toBeGreaterThan(0)
    }
  })
})

describe('RecoverableError (#1074)', () => {
  it('is an instance of ArbiterError and UserFacingError', () => {
    const err = new RecoverableError('E_GH_RECOVERABLE', 'label create failed')
    expect(err).toBeInstanceOf(ArbiterError)
    expect(err).toBeInstanceOf(UserFacingError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "RecoverableError" and kind "recoverable"', () => {
    const err = new RecoverableError('E_GH_RECOVERABLE', 'msg')
    expect(err.name).toBe('RecoverableError')
    expect(err.kind).toBe('recoverable')
  })

  it('exposes code', () => {
    const err = new RecoverableError('E_GH_RECOVERABLE', 'msg')
    expect(err.code).toBe('E_GH_RECOVERABLE')
  })
})

describe('FatalError (#1074)', () => {
  it('is an instance of ArbiterError and UserFacingError', () => {
    const err = new FatalError('E_GH_FATAL', 'auth lost')
    expect(err).toBeInstanceOf(ArbiterError)
    expect(err).toBeInstanceOf(UserFacingError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "FatalError" and kind "fatal"', () => {
    const err = new FatalError('E_GH_FATAL', 'msg')
    expect(err.name).toBe('FatalError')
    expect(err.kind).toBe('fatal')
  })

  it('carries optional recoverableContext from partial progress', () => {
    const err = new FatalError('E_GH_FATAL', 'auth lost', {
      recoverableContext: ['bug: label-create failed', 'feature: label-create failed'],
    })
    expect(err.recoverableContext).toEqual([
      'bug: label-create failed',
      'feature: label-create failed',
    ])
  })

  it('recoverableContext is undefined when not provided', () => {
    const err = new FatalError('E_GH_FATAL', 'auth lost')
    expect(err.recoverableContext).toBeUndefined()
  })
})

describe('ConfigError (#1074)', () => {
  it('is an instance of ArbiterError and UserFacingError', () => {
    const err = new ConfigError('E_CONFIG_INVALID', 'invalid json')
    expect(err).toBeInstanceOf(ArbiterError)
    expect(err).toBeInstanceOf(UserFacingError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "ConfigError" and kind "config"', () => {
    const err = new ConfigError('E_CONFIG_INVALID', 'msg')
    expect(err.name).toBe('ConfigError')
    expect(err.kind).toBe('config')
  })

  it('exposes code', () => {
    const err = new ConfigError('E_CONFIG_NOT_FOUND', 'no config')
    expect(err.code).toBe('E_CONFIG_NOT_FOUND')
  })
})

describe('Error class hierarchy (#1074)', () => {
  it('RecoverableError is NOT instanceof FatalError or ConfigError', () => {
    const err = new RecoverableError('E_GH_RECOVERABLE', 'msg')
    expect(err instanceof FatalError).toBe(false)
    expect(err instanceof ConfigError).toBe(false)
  })

  it('FatalError is NOT instanceof RecoverableError or ConfigError', () => {
    const err = new FatalError('E_GH_FATAL', 'msg')
    expect(err instanceof RecoverableError).toBe(false)
    expect(err instanceof ConfigError).toBe(false)
  })
})

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
