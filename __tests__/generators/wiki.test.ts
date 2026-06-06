// SPDX-License-Identifier: Apache-2.0
// CANON-05 — every generator under src/generators/ has a unit test (#1241)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateWiki } from '../../src/generators/wiki.js'

describe('generateWiki', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns no files at L1 — wiki is L2+ only', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateWiki(config).files).toHaveLength(0)
  })

  it('generates 3 files at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    expect(generateWiki(config).files).toHaveLength(3)
  })

  it('generates 3 files at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateWiki(config).files).toHaveLength(3)
  })

  it('generates 3 files at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateWiki(config).files).toHaveLength(3)
  })

  it('emits scripts/gen-wiki.mjs at L2+', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateWiki(config)
    expect(existsSync(join(dir, 'scripts', 'gen-wiki.mjs'))).toBe(true)
  })

  it('emits scripts/check-wiki-lint.mjs at L2+', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateWiki(config)
    expect(existsSync(join(dir, 'scripts', 'check-wiki-lint.mjs'))).toBe(true)
  })

  it('emits .claude/hooks/wiki-on-commit.mjs at L2+', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateWiki(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'wiki-on-commit.mjs'))).toBe(true)
  })

  it('is idempotent — skipIfExists prevents overwrite on re-run', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    const first = generateWiki(config)
    const second = generateWiki(config)
    const firstCreated = first.files.filter((f) => f.action === 'created').length
    const secondSkipped = second.files.filter((f) => f.action === 'skipped').length
    expect(firstCreated).toBeGreaterThan(0)
    expect(secondSkipped).toBeGreaterThan(0)
  })
})
