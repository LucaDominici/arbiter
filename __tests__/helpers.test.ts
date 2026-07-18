import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { dogfoodRepoMutationLockPath } from './helpers.js'

// ─── dogfoodRepoMutationLockPath (#2026) ──────────────────────────────────────
//
// `withRealRepoMutationLock` previously pinned every checkout to a single
// GLOBAL lock file (`tmpdir()/arbiter-check-self-dogfood-repo-mutation.lock`).
// ADR-103 supports parallel worktree lanes, so two unrelated checkouts would
// serialize (or time out) on each other through that shared file. The lock
// path must be scoped per repo-root: distinct roots -> distinct paths, same
// root -> same (stable) path every call.

describe('dogfoodRepoMutationLockPath', () => {
  it('derives different lock paths for different repo roots', () => {
    const pathA = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter')
    const pathB = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter-wt/run48-w2')
    expect(pathA).not.toBe(pathB)
  })

  it('derives the same lock path for the same repo root across calls', () => {
    const first = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter')
    const second = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter')
    expect(first).toBe(second)
  })

  it('scopes the lock path under the OS tmpdir', () => {
    const path = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter')
    expect(path.startsWith(tmpdir())).toBe(true)
  })

  it('keeps the recognizable lock filename prefix for discoverability', () => {
    const path = dogfoodRepoMutationLockPath('/home/luca/work/repos/arbiter')
    expect(path).toMatch(/arbiter-check-self-dogfood-repo-mutation-[0-9a-f]+\.lock$/)
  })
})
