// SPDX-License-Identifier: Apache-2.0
// #1817 (A4) — installable E2E constitution generator.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateE2eConstitution } from '../../src/generators/e2e-constitution.js'

describe('generateE2eConstitution (#1817, A4)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits E2E_CONSTITUTION.md for frontend-spa archetype', () => {
    const result = generateE2eConstitution(makeConfig(dir, { archetype: 'frontend-spa' }))
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md'))).toBe(true)
  })

  it('emits E2E_CONSTITUTION.md for backend-web-db archetype', () => {
    const result = generateE2eConstitution(makeConfig(dir, { archetype: 'backend-web-db' }))
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md'))).toBe(true)
  })

  it('returns empty files for an archetype with no E2E harness (library)', () => {
    const result = generateE2eConstitution(makeConfig(dir, { archetype: 'library' }))
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md'))).toBe(false)
  })

  it('is idempotent: second run on an untouched file reports skipped, not created', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa' })
    const first = generateE2eConstitution(config)
    expect(first.files[0]?.action).toBe('created')

    const second = generateE2eConstitution(config)
    expect(second.files[0]?.action).toBe('skipped')
  })

  it('never overwrites a user-modified installed file (customizable AC)', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa' })
    generateE2eConstitution(config)
    const target = join(dir, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md')
    writeFileSync(target, '# my customized rules\n', 'utf-8')

    generateE2eConstitution(config)
    expect(readFileSync(target, 'utf-8')).toBe('# my customized rules\n')
  })

  it('dry-run does not write the file', () => {
    const result = generateE2eConstitution(makeConfig(dir, { archetype: 'frontend-spa' }), {
      dryRun: true,
    })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.action).toBe('created')
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md'))).toBe(false)
  })
})
