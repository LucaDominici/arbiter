// SPDX-License-Identifier: Apache-2.0
// CANON-11 brownfield re-init test: wiki generator respects skipIfExists (#1241)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateWiki } from '../../src/generators/wiki.js'

describe('brownfield: wiki generator skipIfExists on re-init (#1241)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('preserves user-modified gen-wiki.mjs on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })

    // First run creates the file
    generateWiki(config)
    const scriptPath = join(dir, 'scripts', 'gen-wiki.mjs')
    expect(existsSync(scriptPath)).toBe(true)

    // User modifies the file
    const customContent = '// user-modified gen-wiki.mjs\n'
    writeFileSync(scriptPath, customContent, 'utf-8')

    // Second run (re-init brownfield) should NOT overwrite
    generateWiki(config)
    const content = readFileSync(scriptPath, 'utf-8')
    expect(content).toBe(customContent)
  })

  it('preserves user-modified check-wiki-lint.mjs on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateWiki(config)
    const lintPath = join(dir, 'scripts', 'check-wiki-lint.mjs')
    const customContent = '// user-modified lint\n'
    writeFileSync(lintPath, customContent, 'utf-8')
    generateWiki(config)
    expect(readFileSync(lintPath, 'utf-8')).toBe(customContent)
  })

  it('L1 project emits no files — wiki is L2+ only', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    const result = generateWiki(config)
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, 'scripts', 'gen-wiki.mjs'))).toBe(false)
  })
})
