// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFrontendGovernance } from '../../src/generators/frontend-governance.js'

describe('generateFrontendGovernance brownfield (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing FRONTEND_CONSTITUTION.md on re-run', () => {
    const govDir = join(dir, 'docs', 'GOVERNANCE')
    mkdirSync(govDir, { recursive: true })
    const target = join(govDir, 'FRONTEND_CONSTITUTION.md')
    const sentinel = '# User-modified FE Constitution — do not overwrite\n'
    writeFileSync(target, sentinel)

    generateFrontendGovernance(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing FE_DESIGN_PRINCIPLES.md on re-run', () => {
    const govDir = join(dir, 'docs', 'GOVERNANCE')
    mkdirSync(govDir, { recursive: true })
    const target = join(govDir, 'FE_DESIGN_PRINCIPLES.md')
    const sentinel = '# User-modified FE principles — do not overwrite\n'
    writeFileSync(target, sentinel)

    generateFrontendGovernance(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('all files are skipped on second run', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa' })
    generateFrontendGovernance(config)
    const result = generateFrontendGovernance(config)
    expect(result.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('does not overwrite existing files on re-run via lanes path', () => {
    const govDir = join(dir, 'docs', 'GOVERNANCE')
    mkdirSync(govDir, { recursive: true })
    const target = join(govDir, 'FRONTEND_CONSTITUTION.md')
    const sentinel = '# User-modified — lanes path\n'
    writeFileSync(target, sentinel)

    generateFrontendGovernance(
      makeConfig(dir, { archetype: 'backend-web-db', lanes: ['frontend'] }),
    )

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })
})
