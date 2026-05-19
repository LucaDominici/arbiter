// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  _resetForTest,
  resolveAdapter,
  registerAdapter,
} from '../../src/adapters/_registry.js'
import { javaAdapter } from '../../src/adapters/java.js'

describe('Java stack adapter', () => {
  beforeEach(() => {
    _resetForTest()
    registerAdapter(javaAdapter)
  })

  afterEach(() => {
    _resetForTest()
  })

  it('language is java', () => {
    expect(javaAdapter.language).toBe('java')
  })

  it('isStub is false', () => {
    expect(javaAdapter.isStub).toBe(false)
  })

  it('lintCommand returns non-null string', () => {
    const lint = javaAdapter.lintCommand()
    expect(lint).not.toBeNull()
    expect(typeof lint).toBe('string')
    expect((lint as string).length).toBeGreaterThan(0)
  })

  it('lintCommand includes checkstyle and pmd', () => {
    const lint = javaAdapter.lintCommand()
    expect(lint).toMatch(/checkstyle/)
    expect(lint).toMatch(/pmd/)
  })

  it('formatCommand returns null (checkstyle handles formatting)', () => {
    expect(javaAdapter.formatCommand()).toBeNull()
  })

  it('supportsCoverage returns true (JaCoCo)', () => {
    expect(javaAdapter.supportsCoverage()).toBe(true)
  })

  it('supportsMutation returns true (Pitest)', () => {
    expect(javaAdapter.supportsMutation()).toBe(true)
  })

  it('languageHooks returns an array', () => {
    const hooks = javaAdapter.languageHooks()
    expect(Array.isArray(hooks)).toBe(true)
  })

  it('resolveAdapter returns the java adapter after registration', () => {
    expect(resolveAdapter('java')).toBe(javaAdapter)
  })
})
