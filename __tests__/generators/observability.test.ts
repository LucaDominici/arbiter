// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateObservability } from '../../src/generators/observability.js'

describe('generateObservability (#725)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/OBSERVABILITY.md when provider is not none', () => {
    generateObservability(makeConfig(dir, { observability: { provider: 'stdout-minimal' } }))
    expect(existsSync(join(dir, 'docs', 'OBSERVABILITY.md'))).toBe(true)
  })

  it('does not generate file when provider is none', () => {
    generateObservability(makeConfig(dir, { observability: { provider: 'none' } }))
    expect(existsSync(join(dir, 'docs', 'OBSERVABILITY.md'))).toBe(false)
  })

  it('does not generate file when observability is absent', () => {
    generateObservability(makeConfig(dir, {}))
    expect(existsSync(join(dir, 'docs', 'OBSERVABILITY.md'))).toBe(false)
  })

  it('generated file contains project name', () => {
    generateObservability(makeConfig(dir, { observability: { provider: 'signoz' } }))
    const content = readFileSync(join(dir, 'docs', 'OBSERVABILITY.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('is skipIfExists — does not overwrite existing file', () => {
    const cfg = makeConfig(dir, { observability: { provider: 'signoz' } })
    const result1 = generateObservability(cfg)
    expect(result1.files[0]?.action).toBe('created')

    const result2 = generateObservability(cfg)
    expect(result2.files[0]?.action).toBe('skipped')
  })

  it('returns empty files array when provider is none', () => {
    const result = generateObservability(makeConfig(dir, { observability: { provider: 'none' } }))
    expect(result.files).toHaveLength(0)
  })
})
