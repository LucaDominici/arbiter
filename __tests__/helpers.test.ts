import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { dogfoodRepoMutationLockPath, withRealRepoMutationLock } from './helpers.js'
import { acquireLock } from '../src/utils/file-lock.js'

vi.mock('../src/utils/file-lock.js', () => ({ acquireLock: vi.fn() }))

const mockedAcquireLock = vi.mocked(acquireLock)

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

describe('withRealRepoMutationLock (#2169)', () => {
  it('lets a concurrent contender retry E_LOCK_CONFLICT until the holder releases', async () => {
    let held = false
    const completed: string[] = []
    mockedAcquireLock.mockImplementation(async () => {
      if (held) throw Object.assign(new Error('contended'), { code: 'E_LOCK_CONFLICT' })
      held = true
      return {
        path: 'test.lock',
        pid: process.pid,
        release: async () => {
          held = false
        },
      }
    })

    const first = withRealRepoMutationLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 125))
      completed.push('first')
    })
    const second = withRealRepoMutationLock(async () => {
      completed.push('second')
    })

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(completed).toEqual(['first', 'second'])
    expect(mockedAcquireLock).toHaveBeenCalledTimes(3)
  })
})
