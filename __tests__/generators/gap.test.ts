// SPDX-License-Identifier: Apache-2.0
// CANON-05 — every generator under src/generators/ has a test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGap } from '../../src/generators/gap.js'

describe('generateGap', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns no files at L1 — gate is L2+ only', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateGap(config).files).toHaveLength(0)
  })

  it('generates 1 file at L2', () => {
    const config = makeConfig(dir)
    expect(generateGap(config).files).toHaveLength(1)
  })

  it('generates 1 file at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateGap(config).files).toHaveLength(1)
  })

  it('generates 1 file at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateGap(config).files).toHaveLength(1)
  })

  it('generates docs/GAP.md at L2+', () => {
    const config = makeConfig(dir)
    generateGap(config)
    expect(existsSync(join(dir, 'docs', 'GAP.md'))).toBe(true)
  })

  it('generated file contains GAP_START sentinel', () => {
    const config = makeConfig(dir)
    generateGap(config)
    const content = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    expect(content).toContain('<!-- GAP_START -->')
  })

  it('skipIfExists: does not overwrite existing GAP.md', () => {
    const config = makeConfig(dir)
    generateGap(config)
    const file1 = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    const result2 = generateGap(config)
    const file2 = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    expect(file1).toBe(file2)
    expect(result2.files[0]?.action).toBe('skipped')
  })
})
