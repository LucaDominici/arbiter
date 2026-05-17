// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { resolveLoggerConfig, resolveFromProcess } from '../../src/utils/logger-config.js'

describe('resolveLoggerConfig', () => {
  it('defaults to info/text when nothing supplied', () => {
    expect(resolveLoggerConfig({})).toEqual({ level: 'info', format: 'text' })
  })

  it('flag wins over env', () => {
    expect(
      resolveLoggerConfig({
        flagLevel: 'debug',
        envLevel: 'warn',
        flagFormat: 'json',
        envFormat: 'text',
      }),
    ).toEqual({ level: 'debug', format: 'json' })
  })

  it('env wins over default when no flag', () => {
    expect(resolveLoggerConfig({ envLevel: 'trace', envFormat: 'json' })).toEqual({
      level: 'trace',
      format: 'json',
    })
  })

  it('invalid level falls back to default', () => {
    expect(resolveLoggerConfig({ flagLevel: 'verbose' })).toEqual({
      level: 'info',
      format: 'text',
    })
  })

  it('case-insensitive', () => {
    expect(resolveLoggerConfig({ flagLevel: 'DEBUG', flagFormat: 'JSON' })).toEqual({
      level: 'debug',
      format: 'json',
    })
  })
})

describe('resolveFromProcess', () => {
  it('extracts --log-level <value>', () => {
    expect(resolveFromProcess(['arbiter', '--log-level', 'debug'], {})).toEqual({
      level: 'debug',
      format: 'text',
    })
  })

  it('extracts --log-format=json (equals form)', () => {
    expect(resolveFromProcess(['arbiter', '--log-format=json'], {})).toEqual({
      level: 'info',
      format: 'json',
    })
  })

  it('reads ARBITER_LOG_LEVEL env when no flag', () => {
    expect(resolveFromProcess([], { ARBITER_LOG_LEVEL: 'debug' })).toEqual({
      level: 'debug',
      format: 'text',
    })
  })
})
