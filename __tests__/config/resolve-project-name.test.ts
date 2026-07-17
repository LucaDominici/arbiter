// SPDX-License-Identifier: Apache-2.0
// #1978: project name must never be derived from the cwd basename when a
// durable source is available. Worktree-based invocations (arbiter's OWN
// recommended isolation model — /wt-open, ADR-103) always run in a directory
// whose basename is NOT the project name, so a naive `basename(targetDir)`
// derivation misnames every generated artifact.
//
// Existing Code Survey (CANON-16 / 35-refactor-first):
//   - grep `resolveProjectName` src/ → no prior definition (new function).
//   - grep `slugifyProjectName(basename` src/ → 3 call sites (init.ts,
//     update.ts, diff.ts), all raw cwd-basename derivation with no precedence.
//   - `detectGitInfo` (src/detectors/git.ts) already derives `projectName`
//     from the git remote origin URL but it is currently UNUSED for naming.
//   - Decision: new pure function `resolveProjectName` in
//     src/config/resolve-project-name.ts, consumed by init/update/diff in
//     place of the raw `slugifyProjectName(basename(targetDir))` call. This
//     is additive (new module) because the precedence chain is a genuinely
//     new responsibility, not a variant of an existing one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveProjectName } from '../../src/config/resolve-project-name.js'
import { getLogger } from '../../src/utils/logger.js'

function initGitRepo(dir: string, remote?: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  if (remote) {
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
  }
}

describe('#1978 resolveProjectName — precedence chain never starts at cwd basename', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    // Root basename is a worktree-style directory name: differs from every
    // durable source below by construction (repro case from the issue).
    root = mkdtempSync(join(tmpdir(), 'arbiter-worktree-'))
    dir = join(root, '1978-project-name-cwd')
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('prefers the stored arbiter.json name over the cwd basename', () => {
    const name = resolveProjectName(dir, { projectName: 'real-project' } as never)
    expect(name).toBe('real-project')
  })

  it('falls back to package.json name when no stored name is present', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-project' }))
    const name = resolveProjectName(dir, null)
    expect(name).toBe('pkg-project')
  })

  it('normalizes a scoped package.json name (@scope/name) to the unscoped part', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@myorg/pkg-project' }))
    const name = resolveProjectName(dir, null)
    expect(name).toBe('pkg-project')
  })

  it('falls back to the git remote repo name when no package.json name exists', () => {
    initGitRepo(dir, 'git@github.com:myorg/remote-project.git')
    const name = resolveProjectName(dir, null)
    expect(name).toBe('remote-project')
  })

  it('falls back to cwd basename as last resort when nothing else resolves', () => {
    initGitRepo(dir) // git repo, no remote configured
    const name = resolveProjectName(dir, null)
    expect(name).toBe('1978-project-name-cwd')
  })

  it('warns when falling back to the cwd basename (issue-mandated WARN)', () => {
    const warnSpy = vi.spyOn(getLogger(), 'warn')
    initGitRepo(dir) // git repo, no remote configured
    resolveProjectName(dir, null)
    expect(warnSpy).toHaveBeenCalledWith(
      'config.project_name_cwd_fallback',
      expect.objectContaining({ fallback: '1978-project-name-cwd' }),
      expect.stringContaining('1978-project-name-cwd'),
    )
    warnSpy.mockRestore()
  })

  it('the worktree repro case: differently-named worktree dir resolves the real name', () => {
    // Simulates `git worktree add /tmp/1978-project-name-cwd <branch>` for a
    // project whose package.json says `real-project` — the worktree dirname
    // must NEVER leak into the resolved project name.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'real-project' }))
    initGitRepo(dir, 'git@github.com:myorg/real-project.git')
    const name = resolveProjectName(dir, null)
    expect(name).toBe('real-project')
    expect(name).not.toContain('1978-project-name-cwd')
  })
})
