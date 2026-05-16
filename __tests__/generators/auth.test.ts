// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateAuth } from '../../src/generators/auth.js'

describe('generateAuth (#726)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/AUTH_SETUP.md when provider is not none', () => {
    generateAuth(makeConfig(dir, { auth: { provider: 'authelia' } }))
    expect(existsSync(join(dir, 'docs', 'AUTH_SETUP.md'))).toBe(true)
  })

  it('does not generate file when provider is none', () => {
    generateAuth(makeConfig(dir, { auth: { provider: 'none' } }))
    expect(existsSync(join(dir, 'docs', 'AUTH_SETUP.md'))).toBe(false)
  })

  it('does not generate file when auth is absent', () => {
    generateAuth(makeConfig(dir, {}))
    expect(existsSync(join(dir, 'docs', 'AUTH_SETUP.md'))).toBe(false)
  })

  it('generated file contains project name', () => {
    generateAuth(makeConfig(dir, { auth: { provider: 'keycloak' } }))
    const content = readFileSync(join(dir, 'docs', 'AUTH_SETUP.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('is skipIfExists — does not overwrite existing file', () => {
    const cfg = makeConfig(dir, { auth: { provider: 'keycloak' } })
    const result1 = generateAuth(cfg)
    expect(result1.files[0]?.action).toBe('created')

    const result2 = generateAuth(cfg)
    expect(result2.files[0]?.action).toBe('skipped')
  })

  it('returns empty files array when provider is none', () => {
    const result = generateAuth(makeConfig(dir, { auth: { provider: 'none' } }))
    expect(result.files).toHaveLength(0)
  })
})
