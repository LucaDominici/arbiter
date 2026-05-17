// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { resolveLocale } from '../../src/i18n/index.js'

describe('resolveLocale() (#657)', () => {
  it('defaults to en with empty env', () => {
    expect(resolveLocale({})).toBe('en')
  })

  it('ARBITER_LOCALE overrides everything', () => {
    expect(resolveLocale({ ARBITER_LOCALE: 'it', LANG: 'fr_FR.UTF-8' })).toBe('it')
  })

  it('LC_ALL takes precedence over LC_MESSAGES and LANG', () => {
    expect(resolveLocale({ LC_ALL: 'de_DE.UTF-8', LC_MESSAGES: 'fr', LANG: 'ja' })).toBe(
      'de_DE.UTF-8',
    )
  })

  it('LC_MESSAGES takes precedence over LANG', () => {
    expect(resolveLocale({ LC_MESSAGES: 'fr_FR', LANG: 'ja_JP.UTF-8' })).toBe('fr_FR')
  })

  it('LANG is used when no higher-priority var set', () => {
    expect(resolveLocale({ LANG: 'it_IT.UTF-8' })).toBe('it_IT.UTF-8')
  })

  it('returns "en" when LANG is "C"', () => {
    expect(resolveLocale({ LANG: 'C' })).toBe('en')
  })

  it('returns "en" when LANG is "POSIX"', () => {
    expect(resolveLocale({ LANG: 'POSIX' })).toBe('en')
  })

  it('returns "en" when all env vars are empty strings', () => {
    expect(resolveLocale({ ARBITER_LOCALE: '', LC_ALL: '', LC_MESSAGES: '', LANG: '' })).toBe('en')
  })
})
