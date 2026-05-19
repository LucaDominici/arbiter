// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import {
  registerAdapter,
  resolveAdapter,
  listAdapters,
  _resetForTest,
} from '../../src/adapters/_registry.js'
import type { StackAdapter } from '../../src/adapters/StackAdapter.js'
import type { Language } from '../../src/wizard/types.js'

// Helpers — build fake adapters without importing real adapter files
function fakeAdapter(language: Language, isStub = false): StackAdapter {
  return {
    language,
    isStub,
    lintCommand: () => null,
    formatCommand: () => null,
    languageHooks: () => [],
    supportsCoverage: () => false,
    supportsMutation: () => false,
  }
}

describe('adapter registry', () => {
  afterEach(() => {
    _resetForTest()
  })

  describe('registerAdapter', () => {
    it('registers an adapter and resolveAdapter returns it', () => {
      const adapter = fakeAdapter('typescript')
      registerAdapter(adapter)
      expect(resolveAdapter('typescript')).toBe(adapter)
    })

    it('throws if the same language is registered twice', () => {
      registerAdapter(fakeAdapter('java'))
      expect(() => registerAdapter(fakeAdapter('java'))).toThrow(
        'StackAdapter already registered for language: java',
      )
    })

    it('allows registering different languages without conflict', () => {
      registerAdapter(fakeAdapter('typescript'))
      registerAdapter(fakeAdapter('python'))
      expect(resolveAdapter('typescript')).toBeDefined()
      expect(resolveAdapter('python')).toBeDefined()
    })
  })

  describe('resolveAdapter', () => {
    it('returns undefined for unregistered language', () => {
      expect(resolveAdapter('go')).toBeUndefined()
    })

    it('returns the correct adapter after registration', () => {
      const go = fakeAdapter('go', true)
      registerAdapter(go)
      expect(resolveAdapter('go')).toBe(go)
    })
  })

  describe('listAdapters', () => {
    it('returns empty array when no adapters registered', () => {
      expect(listAdapters()).toEqual([])
    })

    it('returns all registered adapters', () => {
      const ts = fakeAdapter('typescript')
      const java = fakeAdapter('java', true)
      registerAdapter(ts)
      registerAdapter(java)
      const listed = listAdapters()
      expect(listed).toHaveLength(2)
      expect(listed).toContain(ts)
      expect(listed).toContain(java)
    })
  })

  describe('_resetForTest', () => {
    it('clears all registered adapters', () => {
      registerAdapter(fakeAdapter('rust'))
      _resetForTest()
      expect(resolveAdapter('rust')).toBeUndefined()
      expect(listAdapters()).toEqual([])
    })

    it('allows re-registration after reset', () => {
      registerAdapter(fakeAdapter('typescript'))
      _resetForTest()
      const fresh = fakeAdapter('typescript', false)
      registerAdapter(fresh)
      expect(resolveAdapter('typescript')).toBe(fresh)
    })
  })
})

describe('TypeScript adapter (real)', () => {
  afterEach(() => {
    _resetForTest()
  })

  it('has isStub=false', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    expect(tsAdapter.isStub).toBe(false)
  })

  it('returns a lint command string', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    const lint = tsAdapter.lintCommand()
    expect(typeof lint).toBe('string')
    expect(lint).toBeTruthy()
  })

  it('returns a format command string', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    const format = tsAdapter.formatCommand()
    expect(typeof format).toBe('string')
    expect(format).toBeTruthy()
  })

  it('has language = typescript', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    expect(tsAdapter.language).toBe('typescript')
  })

  it('supportsCoverage returns true', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    expect(tsAdapter.supportsCoverage()).toBe(true)
  })

  it('supportsMutation returns true', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    expect(tsAdapter.supportsMutation()).toBe(true)
  })

  it('languageHooks returns at least one hook', async () => {
    const { tsAdapter } = await import('../../src/adapters/typescript.js')
    const hooks = tsAdapter.languageHooks()
    expect(hooks.length).toBeGreaterThan(0)
    for (const hook of hooks) {
      expect(typeof hook.name).toBe('string')
      expect(typeof hook.description).toBe('string')
      expect(typeof hook.body).toBe('string')
    }
  })
})

describe('stub adapters', () => {
  afterEach(() => {
    _resetForTest()
  })

  const stubs = ['java', 'python', 'go', 'rust'] as const

  for (const lang of stubs) {
    it(`${lang} adapter has isStub=true`, async () => {
      const mod = await import(`../../src/adapters/${lang}.js`)
      const adapter = mod[`${lang}Adapter`] as StackAdapter
      expect(adapter.isStub).toBe(true)
    })

    it(`${lang} adapter lintCommand returns null`, async () => {
      const mod = await import(`../../src/adapters/${lang}.js`)
      const adapter = mod[`${lang}Adapter`] as StackAdapter
      expect(adapter.lintCommand()).toBeNull()
    })

    it(`${lang} adapter formatCommand returns null`, async () => {
      const mod = await import(`../../src/adapters/${lang}.js`)
      const adapter = mod[`${lang}Adapter`] as StackAdapter
      expect(adapter.formatCommand()).toBeNull()
    })

    it(`${lang} adapter languageHooks returns empty array`, async () => {
      const mod = await import(`../../src/adapters/${lang}.js`)
      const adapter = mod[`${lang}Adapter`] as StackAdapter
      expect(adapter.languageHooks()).toEqual([])
    })

    it(`${lang} adapter has language = ${lang}`, async () => {
      const mod = await import(`../../src/adapters/${lang}.js`)
      const adapter = mod[`${lang}Adapter`] as StackAdapter
      expect(adapter.language).toBe(lang)
    })
  }
})

describe('language exhaustiveness', () => {
  it('REQUIRED + EXEMPT covers all Language values', () => {
    const REQUIRED_LANGUAGES = ['typescript', 'java', 'python', 'go', 'rust']
    const EXEMPT_LANGUAGES = ['kotlin', 'multi', 'unknown']
    const ALL_LANGUAGES: Language[] = [
      'typescript',
      'java',
      'kotlin',
      'rust',
      'python',
      'go',
      'multi',
      'unknown',
    ]
    const combined = [...REQUIRED_LANGUAGES, ...EXEMPT_LANGUAGES].sort()
    expect(combined).toEqual([...ALL_LANGUAGES].sort())
  })
})
