import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
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

  it('writes setup-repo.sh + apply-branch-protection.mjs + 4 gate scripts when useGitHub=true and L2', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(6)
    expect(result.files.some((f) => f.path.endsWith('setup-repo.sh'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('apply-branch-protection.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-ci-tiers.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-action-pins.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-workflow-perms.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-merge-method.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'setup-repo.sh'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'apply-branch-protection.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-ci-tiers.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-action-pins.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-workflow-perms.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-merge-method.mjs'))).toBe(true)
  })

  it('returns empty files when useGitHub=false', () => {
    const config = makeConfig(dir, { useGitHub: false, governanceLevel: 'L2' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(0)
  })

  it('L1: emits apply-branch-protection.mjs + 4 gate scripts but not setup-repo.sh', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L1' })
    const result = generateGithubSetup(config)
    expect(result.files).toHaveLength(5)
    expect(result.files.some((f) => f.path.endsWith('apply-branch-protection.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-ci-tiers.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-action-pins.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-workflow-perms.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('check-merge-method.mjs'))).toBe(true)
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

  it('apply-branch-protection.mjs is regenerated (replaced) when its content differs on re-run', () => {
    // apply-branch-protection.mjs is a non-skipIfExists, non-backup file: it is
    // overwritten when content differs. (#1077: a byte-identical re-run now skips —
    // see the idempotence test below — so this asserts the DIFFERING branch.)
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    const first = generateGithubSetup(config)
    const path = first.files.find((f) => f.path.endsWith('apply-branch-protection.mjs'))!.path
    writeFileSync(path, '// user-edited\n', 'utf-8')
    const second = generateGithubSetup(config)
    const bpFile = second.files.find((f) => f.path.endsWith('apply-branch-protection.mjs'))
    expect(bpFile?.action).toBe('replaced')
  })

  it('apply-branch-protection.mjs skips a byte-identical re-run (#1077 F6 idempotence)', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    const second = generateGithubSetup(config)
    const bpFile = second.files.find((f) => f.path.endsWith('apply-branch-protection.mjs'))
    expect(bpFile?.action).toBe('skipped')
  })

  it('gate scripts are regenerated (replaced) when their content differs on re-run', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    const first = generateGithubSetup(config)
    const names = [
      'check-ci-tiers.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-merge-method.mjs',
    ]
    for (const name of names) {
      const path = first.files.find((r) => r.path.endsWith(name))!.path
      writeFileSync(path, '// user-edited\n', 'utf-8')
    }
    const second = generateGithubSetup(config)
    for (const name of names) {
      const f = second.files.find((r) => r.path.endsWith(name))
      expect(f?.action).toBe('replaced')
    }
  })

  it('gate scripts skip a byte-identical re-run (#1077 F6 idempotence)', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    const second = generateGithubSetup(config)
    for (const name of [
      'check-ci-tiers.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-merge-method.mjs',
    ]) {
      const f = second.files.find((r) => r.path.endsWith(name))
      expect(f?.action).toBe('skipped')
    }
  })

  it('places scripts under scripts/ directory at project root', () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' })
    generateGithubSetup(config)
    expect(existsSync(join(dir, 'scripts', 'setup-repo.sh'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'apply-branch-protection.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-ci-tiers.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-action-pins.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-workflow-perms.mjs'))).toBe(true)
  })
})
