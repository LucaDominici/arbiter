// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGithub } from '../../src/generators/github.js'

describe('brownfield: deploy workflow generator (CANON-11, #899)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite user-customized 04-deploy-test.yml on re-run', () => {
    const config = makeConfig(dir, { deployTarget: 'ghcr' })
    generateGithub(config)

    const path = join(dir, '.github', 'workflows', '04-deploy-test.yml')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-customized deploy-test')

    generateGithub(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-customized deploy-test')
  })

  it('does not overwrite user-customized 10-deploy-prod.yml on re-run', () => {
    const config = makeConfig(dir, { deployTarget: 'ghcr' })
    generateGithub(config)

    const path = join(dir, '.github', 'workflows', '10-deploy-prod.yml')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-customized deploy-prod')

    generateGithub(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-customized deploy-prod')
  })

  it('does not emit deploy workflows on re-run when flag disabled', () => {
    // First run with deploy enabled
    generateGithub(makeConfig(dir, { deployTarget: 'ghcr' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(true)

    // Re-run without deploy — files should stay (user owns them now), no overwrite
    // The generator should not crash when files exist and flag is false
    generateGithub(makeConfig(dir, { deployTarget: 'none' }))
    // Files remain (generator doesn't delete, only skips creation)
    // Standard workflows are still created without error
    expect(existsSync(join(wfDir, '01-pr-fast.yml'))).toBe(true)
  })
})
