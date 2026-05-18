import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGithubSetup } from '../../src/generators/github-setup.js'

describe('generateGithubSetup', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('writes setup-repo.sh + apply-branch-protection.mjs when useGitHub=true and L2', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(2)
    expect(result.files.some((f) => f.path.endsWith('setup-repo.sh'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('apply-branch-protection.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'setup-repo.sh'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'apply-branch-protection.mjs'))).toBe(true)
  })

  it('returns empty files when useGitHub=false', () => {
    const config = makeConfig(dir, { useGitHub: false, governanceLevel: 'L2' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(0)
  })

  it('L1: emits apply-branch-protection.mjs but not setup-repo.sh', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L1' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toContain('apply-branch-protection.mjs')
    expect(existsSync(join(dir, 'scripts', 'setup-repo.sh'))).toBe(false)
    expect(existsSync(join(dir, 'scripts', 'apply-branch-protection.mjs'))).toBe(true)
  })

  it('setup-repo.sh skips on second invocation (idempotent)', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    const second = generateGithubSetup(config)
    const setupFile = second.files.find((f) => f.path.endsWith('setup-repo.sh'))
    expect(setupFile?.action).toBe('skipped')
  })

  it('apply-branch-protection.mjs is always regenerated on re-run', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    const second = generateGithubSetup(config)
    const bpFile = second.files.find((f) => f.path.endsWith('apply-branch-protection.mjs'))
    expect(bpFile?.action).toBe('replaced')
  })

  it('places scripts under scripts/ directory at project root', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    expect(existsSync(join(dir, 'scripts', 'setup-repo.sh'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'apply-branch-protection.mjs'))).toBe(true)
  })
})
