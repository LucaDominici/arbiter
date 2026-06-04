// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateResilience } from '../../src/generators/resilience.js'

// CANON-11 — every file-emitting generator has a brownfield test verifying
// user-modified files survive re-init (skipIfExists semantics).

describe('brownfield: resilience generator — skipIfExists', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function backendConfig(language: 'typescript' | 'java' | 'go' = 'typescript') {
    return makeConfig(dir, {
      archetype: 'backend-web-db',
      language,
      governanceLevel: 'L2',
    })
  }

  it('preserves user modifications on re-run (sentinel survives)', () => {
    const config = backendConfig()

    // First run: generate the file
    generateResilience(config)

    const outputPath = join(dir, 'docs', 'GOVERNANCE', 'RESILIENCE.md')
    expect(existsSync(outputPath)).toBe(true)

    // Simulate user modification: write a sentinel into the generated file
    const original = readFileSync(outputPath, 'utf-8')
    const sentinel = '<!-- USER_CUSTOM_RESILIENCE_POLICY -->'
    writeFileSync(outputPath, original + '\n' + sentinel)

    // Second run: must NOT overwrite the file
    const result2 = generateResilience(config)
    expect(result2.files[0]?.action).toBe('skipped')

    // Sentinel must survive
    const afterContent = readFileSync(outputPath, 'utf-8')
    expect(afterContent).toContain(sentinel)
  })

  it('file action is "created" on first run', () => {
    const config = backendConfig()
    const result = generateResilience(config)
    expect(result.files[0]?.action).toBe('created')
  })

  it('file action is "skipped" on second run', () => {
    const config = backendConfig()
    generateResilience(config)
    const result2 = generateResilience(config)
    expect(result2.files[0]?.action).toBe('skipped')
  })

  it('no files emitted when archetype is not backend-web-db (brownfield-safe guard)', () => {
    const config = makeConfig(dir, {
      archetype: 'cli',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    const result = generateResilience(config)
    expect(result.files).toHaveLength(0)
  })
})
