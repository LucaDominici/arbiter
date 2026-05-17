// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { resolveChannel, needsDowngradeWarn, CHANNEL_STABILITY } from '../../src/utils/channel.js'

describe('resolveChannel', () => {
  it('flag > config > default precedence', () => {
    expect(resolveChannel({ flag: 'beta', config: 'latest' })).toEqual({
      value: 'beta',
      source: 'flag',
    })
    expect(resolveChannel({ config: 'canary' })).toEqual({ value: 'canary', source: 'config' })
    expect(resolveChannel({})).toEqual({ value: 'latest', source: 'default' })
  })

  it('returns correct source for each path', () => {
    expect(resolveChannel({ flag: 'latest' }).source).toBe('flag')
    expect(resolveChannel({ config: 'beta' }).source).toBe('config')
    expect(resolveChannel({}).source).toBe('default')
  })

  it('all valid channels pass', () => {
    for (const ch of ['latest', 'beta', 'canary'] as const) {
      expect(() => resolveChannel({ flag: ch })).not.toThrow()
      expect(() => resolveChannel({ config: ch })).not.toThrow()
    }
  })

  it('throws on invalid flag value', () => {
    expect(() => resolveChannel({ flag: 'stable' })).toThrow('invalid channel')
    expect(() => resolveChannel({ flag: 'nightly' })).toThrow('invalid channel')
    expect(() => resolveChannel({ flag: '' })).toThrow('invalid channel')
  })

  it('throws on invalid config value', () => {
    expect(() => resolveChannel({ config: 'preview' })).toThrow('invalid channel')
    expect(() => resolveChannel({ config: 'latst' })).toThrow('invalid channel')
  })
})

describe('CHANNEL_STABILITY', () => {
  it('latest < beta < canary', () => {
    expect(CHANNEL_STABILITY.latest).toBeLessThan(CHANNEL_STABILITY.beta)
    expect(CHANNEL_STABILITY.beta).toBeLessThan(CHANNEL_STABILITY.canary)
  })
})

describe('needsDowngradeWarn — 3×3 matrix', () => {
  // Matrix rows: config channel (what's stored). Columns: flag channel.
  // Warn ONLY when config is explicit + flag is less stable than config.

  // row: no config set (absent = default)
  it('no config + any flag = no warn (opt-in)', () => {
    expect(needsDowngradeWarn({ flag: 'latest', configChannel: undefined })).toBe(false)
    expect(needsDowngradeWarn({ flag: 'beta', configChannel: undefined })).toBe(false)
    expect(needsDowngradeWarn({ flag: 'canary', configChannel: undefined })).toBe(false)
  })

  // row: config = latest
  it('config=latest + flag=latest = no warn', () => {
    expect(needsDowngradeWarn({ flag: 'latest', configChannel: 'latest' })).toBe(false)
  })
  it('config=latest + flag=beta = warn', () => {
    expect(needsDowngradeWarn({ flag: 'beta', configChannel: 'latest' })).toBe(true)
  })
  it('config=latest + flag=canary = warn', () => {
    expect(needsDowngradeWarn({ flag: 'canary', configChannel: 'latest' })).toBe(true)
  })

  // row: config = beta
  it('config=beta + flag=latest = no warn (upgrade)', () => {
    expect(needsDowngradeWarn({ flag: 'latest', configChannel: 'beta' })).toBe(false)
  })
  it('config=beta + flag=beta = no warn (lateral)', () => {
    expect(needsDowngradeWarn({ flag: 'beta', configChannel: 'beta' })).toBe(false)
  })
  it('config=beta + flag=canary = warn', () => {
    expect(needsDowngradeWarn({ flag: 'canary', configChannel: 'beta' })).toBe(true)
  })

  // row: config = canary
  it('config=canary + flag=latest = no warn (upgrade)', () => {
    expect(needsDowngradeWarn({ flag: 'latest', configChannel: 'canary' })).toBe(false)
  })
  it('config=canary + flag=beta = no warn (upgrade)', () => {
    expect(needsDowngradeWarn({ flag: 'beta', configChannel: 'canary' })).toBe(false)
  })
  it('config=canary + flag=canary = no warn', () => {
    expect(needsDowngradeWarn({ flag: 'canary', configChannel: 'canary' })).toBe(false)
  })

  // no flag = never warn
  it('no flag = never warn regardless of config', () => {
    expect(needsDowngradeWarn({ flag: undefined, configChannel: 'latest' })).toBe(false)
    expect(needsDowngradeWarn({ flag: undefined, configChannel: 'beta' })).toBe(false)
    expect(needsDowngradeWarn({ flag: undefined, configChannel: 'canary' })).toBe(false)
    expect(needsDowngradeWarn({ flag: undefined, configChannel: undefined })).toBe(false)
  })
})
