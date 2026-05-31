// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFrontendGovernance } from '../../src/generators/frontend-governance.js'

describe('generateFrontendGovernance (#1124)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits 2 files for frontend-spa archetype', () => {
    const result = generateFrontendGovernance(makeConfig(dir, { archetype: 'frontend-spa' }))
    expect(result.files).toHaveLength(2)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FE_DESIGN_PRINCIPLES.md'))).toBe(true)
  })

  it('emits 2 files when lanes includes frontend (non-spa archetype)', () => {
    const result = generateFrontendGovernance(
      makeConfig(dir, { archetype: 'backend-web-db', lanes: ['frontend', 'backend'] }),
    )
    expect(result.files).toHaveLength(2)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FE_DESIGN_PRINCIPLES.md'))).toBe(true)
  })

  it('returns empty files for non-frontend archetype with no frontend lane', () => {
    const result = generateFrontendGovernance(
      makeConfig(dir, { archetype: 'backend-web-db', lanes: ['backend'] }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('is idempotent — second run returns action skipped', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa' })
    const result1 = generateFrontendGovernance(config)
    expect(result1.files[0].action).toBe('created')
    expect(result1.files[1].action).toBe('created')

    const result2 = generateFrontendGovernance(config)
    expect(result2.files[0].action).toBe('skipped')
    expect(result2.files[1].action).toBe('skipped')
  })

  it('constitution contains Pinia for vue config', () => {
    generateFrontendGovernance(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        frontend: { framework: 'vue', stateManager: 'pinia' },
      }),
    )
    const content = readFileSync(
      join(dir, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'),
      'utf-8',
    )
    expect(content).toMatch(/pinia/i)
  })

  it('constitution contains Zustand for react config', () => {
    generateFrontendGovernance(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        frontend: { framework: 'react', stateManager: 'zustand' },
      }),
    )
    const content = readFileSync(
      join(dir, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'),
      'utf-8',
    )
    expect(content).toMatch(/zustand/i)
  })

  it('dryRun: true returns created action without writing files', () => {
    const result = generateFrontendGovernance(makeConfig(dir, { archetype: 'frontend-spa' }), {
      dryRun: true,
    })
    expect(result.files).toHaveLength(2)
    expect(result.files[0].action).toBe('created')
    expect(result.files[1].action).toBe('created')
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'))).toBe(false)
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'FE_DESIGN_PRINCIPLES.md'))).toBe(false)
  })
})
