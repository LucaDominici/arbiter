// SPDX-License-Identifier: Apache-2.0
/**
 * Registry unit tests use fake adapters to avoid double-registration issues.
 * Real adapter constants (tsAdapter etc.) are imported for property tests only.
 * All tests call _resetForTest() in beforeEach/afterEach to isolate registry state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerAdapter,
  resolveAdapter,
  listAdapters,
  _resetForTest,
} from '../../src/adapters/_registry.js'
import type { StackAdapter } from '../../src/adapters/StackAdapter.js'
import type { Language } from '../../src/wizard/types.js'

// Static imports for real adapter property tests (modules load and self-register once)
import { tsAdapter } from '../../src/adapters/typescript.js'
import { javaAdapter } from '../../src/adapters/java.js'
import { pythonAdapter } from '../../src/adapters/python.js'
import { goAdapter } from '../../src/adapters/go.js'
import { rustAdapter } from '../../src/adapters/rust.js'

// Helpers — build fake adapters for registry tests without relying on real adapters
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
  beforeEach(() => {
    // Clear adapters self-registered by module imports at the top of this file
    _resetForTest()
  })

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
  it('has isStub=false', () => {
    expect(tsAdapter.isStub).toBe(false)
  })

  it('returns a lint command string', () => {
    const lint = tsAdapter.lintCommand()
    expect(typeof lint).toBe('string')
    expect(lint).toBeTruthy()
  })

  it('returns a format command string', () => {
    const format = tsAdapter.formatCommand()
    expect(typeof format).toBe('string')
    expect(format).toBeTruthy()
  })

  it('has language = typescript', () => {
    expect(tsAdapter.language).toBe('typescript')
  })

  it('supportsCoverage returns true', () => {
    expect(tsAdapter.supportsCoverage()).toBe(true)
  })

  it('supportsMutation returns true', () => {
    expect(tsAdapter.supportsMutation()).toBe(true)
  })

  it('languageHooks returns at least one hook', () => {
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
  const stubs: [string, StackAdapter][] = [
    ['java', javaAdapter],
    ['python', pythonAdapter],
    ['go', goAdapter],
    ['rust', rustAdapter],
  ]

  for (const [lang, adapter] of stubs) {
    it(`${lang} adapter has isStub=true`, () => {
      expect(adapter.isStub).toBe(true)
    })

    it(`${lang} adapter lintCommand returns null`, () => {
      expect(adapter.lintCommand()).toBeNull()
    })

    it(`${lang} adapter formatCommand returns null`, () => {
      expect(adapter.formatCommand()).toBeNull()
    })

    it(`${lang} adapter languageHooks returns empty array`, () => {
      expect(adapter.languageHooks()).toEqual([])
    })

    it(`${lang} adapter has language = ${lang}`, () => {
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
