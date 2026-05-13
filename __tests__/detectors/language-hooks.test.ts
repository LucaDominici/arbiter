import { describe, it, expect } from 'vitest'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'

describe('getLanguageHooks', () => {
  it('always includes orphan TODO hook', () => {
    for (const lang of ['typescript', 'rust', 'java', 'go', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-orphan-todo.mjs')).toBe(true)
    }
  })

  it('includes no-any hook for typescript', () => {
    const hooks = getLanguageHooks('typescript')
    const noAny = hooks.find((h) => h.name === 'check-no-any.mjs')
    expect(noAny).toBeDefined()
    expect(noAny!.body).toContain('.ts')
    expect(noAny!.description).toContain('any')
  })

  it('includes no-unwrap hook for rust', () => {
    const hooks = getLanguageHooks('rust')
    const noUnwrap = hooks.find((h) => h.name === 'check-no-unwrap.mjs')
    expect(noUnwrap).toBeDefined()
    expect(noUnwrap!.body).toContain('.unwrap()')
    expect(noUnwrap!.description).toContain('unwrap')
  })

  it('includes check-no-unchecked-err hook for go', () => {
    const hooks = getLanguageHooks('go')
    const noUnchecked = hooks.find((h) => h.name === 'check-no-unchecked-err.mjs')
    expect(noUnchecked).toBeDefined()
    expect(noUnchecked!.body).toContain('.go')
    expect(noUnchecked!.description).toMatch(/error/i)
  })

  it('includes check-no-bare-except hook for python', () => {
    const hooks = getLanguageHooks('python')
    const noBareExcept = hooks.find((h) => h.name === 'check-no-bare-except.mjs')
    expect(noBareExcept).toBeDefined()
    expect(noBareExcept!.body).toContain('.py')
    expect(noBareExcept!.description).toMatch(/except/i)
  })

  it('does not include no-any for non-typescript', () => {
    for (const lang of ['rust', 'java', 'go', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-any.mjs')).toBe(false)
    }
  })

  it('does not include no-unwrap for non-rust', () => {
    for (const lang of ['typescript', 'java', 'go', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-unwrap.mjs')).toBe(false)
    }
  })

  it('does not include check-no-unchecked-err for non-go', () => {
    for (const lang of ['typescript', 'rust', 'java', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-unchecked-err.mjs')).toBe(false)
    }
  })

  it('does not include check-no-bare-except for non-python', () => {
    for (const lang of ['typescript', 'rust', 'java', 'go', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-bare-except.mjs')).toBe(false)
    }
  })

  it('returns 2 hooks for typescript (orphan-todo + no-any)', () => {
    expect(getLanguageHooks('typescript')).toHaveLength(2)
  })

  it('returns 2 hooks for rust (orphan-todo + no-unwrap)', () => {
    expect(getLanguageHooks('rust')).toHaveLength(2)
  })

  it('returns 3 hooks for java (orphan-todo + no-raw-types + no-mockmvc)', () => {
    expect(getLanguageHooks('java')).toHaveLength(3)
  })

  it('returns 2 hooks for go (orphan-todo + no-unchecked-err)', () => {
    expect(getLanguageHooks('go')).toHaveLength(2)
  })

  it('returns 2 hooks for python (orphan-todo + no-bare-except)', () => {
    expect(getLanguageHooks('python')).toHaveLength(2)
  })

  it('includes check-no-raw-types hook for java', () => {
    const hooks = getLanguageHooks('java')
    const noRawTypes = hooks.find((h) => h.name === 'check-no-raw-types.mjs')
    expect(noRawTypes).toBeDefined()
    expect(noRawTypes!.body).toContain('.java')
    expect(noRawTypes!.body).toContain('List')
    expect(noRawTypes!.description).toMatch(/raw/i)
  })

  it('does not include check-no-raw-types for non-java', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-raw-types.mjs')).toBe(false)
    }
  })

  it('includes check-no-mockmvc hook for java', () => {
    const hooks = getLanguageHooks('java')
    const noMockMvc = hooks.find((h) => h.name === 'check-no-mockmvc.mjs')
    expect(noMockMvc).toBeDefined()
    expect(noMockMvc!.body).toContain('.java')
    expect(noMockMvc!.description).toMatch(/MockMvc/i)
  })

  it('check-no-mockmvc blocks MockMvc import patterns', () => {
    const hooks = getLanguageHooks('java')
    const noMockMvc = hooks.find((h) => h.name === 'check-no-mockmvc.mjs')!
    // The regex in the hook body should match MockMvc patterns
    const regex =
      /MockMvc|AutoConfigureMockMvc|MockMvcBuilders|MockMvcRequestBuilders|MockMvcResultMatchers/
    expect(regex.test('import org.springframework.test.web.servlet.MockMvc;')).toBe(true)
    expect(regex.test('import org.springframework.test.web.servlet.MockMvcBuilders;')).toBe(true)
    expect(
      regex.test(
        'import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;',
      ),
    ).toBe(true)
    // RestAssured should NOT match
    expect(regex.test('import io.restassured.RestAssured;')).toBe(false)
    expect(regex.test('import io.restassured.http.ContentType;')).toBe(false)
    // The hook body should contain the regex pattern
    expect(noMockMvc!.body).toContain('MockMvc')
  })

  it('check-no-mockmvc does not appear for non-java', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python', 'unknown'] as const) {
      const hooks = getLanguageHooks(lang)
      expect(hooks.some((h) => h.name === 'check-no-mockmvc.mjs')).toBe(false)
    }
  })

  it('all hooks have valid shebang', () => {
    for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
      const hooks = getLanguageHooks(lang)
      for (const hook of hooks) {
        expect(hook.body).toMatch(/^#!/)
      }
    }
  })

  it('check-no-raw-types skips import/package lines (#278 #6)', () => {
    const hooks = getLanguageHooks('java')
    const hook = hooks.find((h) => h.name === 'check-no-raw-types.mjs')!
    // The hook body must contain the import/package exclusion clause introduced
    // for #278 #6. We assert via source-level regex since the hook is emitted
    // as a string to be written to disk in target projects.
    expect(hook.body).toMatch(/import /)
    expect(hook.body).toMatch(/package /)
    expect(hook.body).toContain("t.startsWith('import ')")
    expect(hook.body).toContain("t.startsWith('package ')")
  })
})
