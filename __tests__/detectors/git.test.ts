import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { detectGitInfo, detectAdverseGitState } from '../../src/detectors/git.js'
import { createTestProject, initGit, cleanupTestProject } from '../helpers.js'

describe('detectGitInfo', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns isGitRepo=false for non-git directory', () => {
    const info = detectGitInfo(dir)
    expect(info.isGitRepo).toBe(false)
    expect(info.remoteUrl).toBeNull()
    expect(info.githubOwner).toBeNull()
    expect(info.githubRepo).toBeNull()
    expect(info.projectName).toBeNull()
  })

  it('returns isGitRepo=true for git-initialized directory', () => {
    initGit(dir)
    const info = detectGitInfo(dir)
    expect(info.isGitRepo).toBe(true)
  })

  it('parses HTTPS GitHub remote URL', () => {
    initGit(dir, 'https://github.com/TestUser/my-repo.git')
    const info = detectGitInfo(dir)
    expect(info.isGitRepo).toBe(true)
    expect(info.githubOwner).toBe('TestUser')
    expect(info.githubRepo).toBe('my-repo')
    expect(info.projectName).toBe('my-repo')
  })

  it('parses SSH GitHub remote URL', () => {
    initGit(dir, 'git@github.com:TestUser/my-repo.git')
    const info = detectGitInfo(dir)
    expect(info.githubOwner).toBe('TestUser')
    expect(info.githubRepo).toBe('my-repo')
  })

  it('parses HTTPS URL without .git suffix', () => {
    initGit(dir, 'https://github.com/Owner/repo')
    const info = detectGitInfo(dir)
    expect(info.githubOwner).toBe('Owner')
    expect(info.githubRepo).toBe('repo')
  })

  it('returns null owner/repo for non-GitHub remote', () => {
    initGit(dir, 'https://gitlab.com/user/repo.git')
    const info = detectGitInfo(dir)
    expect(info.isGitRepo).toBe(true)
    expect(info.remoteUrl).toBe('https://gitlab.com/user/repo.git')
    expect(info.githubOwner).toBeNull()
    expect(info.githubRepo).toBeNull()
  })

  it('returns null remote when no origin set', () => {
    initGit(dir)
    const info = detectGitInfo(dir)
    expect(info.remoteUrl).toBeNull()
    expect(info.githubOwner).toBeNull()
  })

  it('preserves dots in repo names over SSH (#278 #5)', () => {
    initGit(dir, 'git@github.com:TestUser/my.project.git')
    const info = detectGitInfo(dir)
    expect(info.githubOwner).toBe('TestUser')
    expect(info.githubRepo).toBe('my.project')
  })

  it('preserves dots in repo names over HTTPS without .git suffix (#278 #5)', () => {
    initGit(dir, 'https://github.com/TestUser/dot.repo')
    const info = detectGitInfo(dir)
    expect(info.githubOwner).toBe('TestUser')
    expect(info.githubRepo).toBe('dot.repo')
  })

  it('preserves dots in repo names over HTTPS with .git suffix (#278 #5)', () => {
    initGit(dir, 'https://github.com/TestUser/my.project.git')
    const info = detectGitInfo(dir)
    expect(info.githubOwner).toBe('TestUser')
    expect(info.githubRepo).toBe('my.project')
  })
})

describe('detectAdverseGitState (#617)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns null for non-git directory', () => {
    expect(detectAdverseGitState(dir)).toBeNull()
  })

  it('returns null for clean git repo on a branch', () => {
    initGit(dir)
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
    expect(detectAdverseGitState(dir)).toBeNull()
  })

  it('detects detached HEAD', () => {
    initGit(dir)
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['checkout', '--detach'], { cwd: dir, stdio: 'ignore' })
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('detached-head')
    expect(state?.message).toBeTruthy()
    expect(state?.suggestedFix).toBeTruthy()
  })

  it('detects merge in progress', () => {
    initGit(dir)
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), '0000000000000000000000000000000000000000\n')
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('merge')
  })

  it('detects cherry-pick in progress', () => {
    initGit(dir)
    writeFileSync(
      join(dir, '.git', 'CHERRY_PICK_HEAD'),
      '0000000000000000000000000000000000000000\n',
    )
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('cherry-pick')
  })

  it('detects rebase in progress via rebase-merge dir', () => {
    initGit(dir)
    mkdirSync(join(dir, '.git', 'rebase-merge'), { recursive: true })
    writeFileSync(join(dir, '.git', 'rebase-merge', 'head-name'), 'refs/heads/main\n')
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('rebase')
  })

  it('detects rebase in progress via rebase-apply dir', () => {
    initGit(dir)
    mkdirSync(join(dir, '.git', 'rebase-apply'), { recursive: true })
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('rebase')
  })

  it('detects bisect in progress', () => {
    initGit(dir)
    writeFileSync(join(dir, '.git', 'BISECT_LOG'), 'git bisect log\n')
    const state = detectAdverseGitState(dir)
    expect(state).not.toBeNull()
    expect(state?.type).toBe('bisect')
  })
})
