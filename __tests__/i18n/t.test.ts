// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { t, loadCatalog, resetForTest } from '../../src/i18n/index.js'

describe('t() (#656)', () => {
  beforeEach(() => {
    resetForTest()
  })

  it('returns string for known key', () => {
    expect(t('cli.shared.done')).toBe('Done.')
  })

  it('returns key string for unknown key (fallback)', () => {
    expect(t('unknown.key.xyz')).toBe('unknown.key.xyz')
  })

  it('interpolates single {var} placeholder', () => {
    expect(t('cli.shared.version_info', { version: '1.2.3' })).toBe('arbiter 1.2.3')
  })

  it('interpolates multiple {var} placeholders', () => {
    expect(t('errors.E_CONFIGURE_INVALID', { key: 'governanceLevel', value: 'extreme' })).toBe(
      'Invalid configuration value for governanceLevel: extreme.',
    )
  })

  it('numeric params stringify correctly', () => {
    expect(t('errors.E_LOCK_TIMEOUT', { ms: 5000 })).toBe('File lock timed out after 5000ms.')
  })

  it('unreplaced {var} tokens remain when param omitted', () => {
    const result = t('cli.shared.version_info')
    expect(result).toBe('arbiter {version}')
  })

  it('returns key for deeply nested missing key', () => {
    expect(t('a.b.c.d.e')).toBe('a.b.c.d.e')
  })
})

describe('loadCatalog() (#656)', () => {
  beforeEach(() => {
    resetForTest()
  })

  it('returns a Catalog map for locale "en"', () => {
    const catalog = loadCatalog('en')
    expect(catalog.size).toBeGreaterThan(0)
  })

  it('loaded catalog contains expected error keys', () => {
    const catalog = loadCatalog('en')
    expect(catalog.get('errors.E_CONFIG_NOT_FOUND')).toBeTruthy()
    expect(catalog.get('cli.shared.done')).toBe('Done.')
  })

  it('falls back to en for unknown locale', () => {
    const catalog = loadCatalog('zz')
    expect(catalog.get('cli.shared.done')).toBe('Done.')
  })

  it('caches catalog on repeated loads', () => {
    const a = loadCatalog('en')
    const b = loadCatalog('en')
    expect(a).toBe(b)
  })

  it('resetForTest() clears cache so catalog reloads', () => {
    const a = loadCatalog('en')
    resetForTest()
    const b = loadCatalog('en')
    expect(a).not.toBe(b)
  })
})
