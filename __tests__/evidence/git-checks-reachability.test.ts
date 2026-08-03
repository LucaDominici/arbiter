// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shaExistsOnBranch, resolveEvidenceCommit } from '../../src/evidence/git-checks.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim()
}

describe('shaExistsOnBranch reachability (#2173)', () => {
  it('rejects an orphaned commit object while accepting the rewritten branch head', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-git-reachability-'))
    roots.push(root)
    git(root, ['init', '--initial-branch=main'])
    git(root, ['config', 'user.name', 'Arbiter Test'])
    git(root, ['config', 'user.email', ['arbiter-test', 'example.invalid'].join('@')])
    writeFileSync(join(root, 'proof.txt'), 'base\n')
    git(root, ['add', 'proof.txt'])
    git(root, ['commit', '-m', 'base'])

    writeFileSync(join(root, 'proof.txt'), 'stale\n')
    git(root, ['commit', '-am', 'stale evidence commit'])
    const orphanedSha = git(root, ['rev-parse', 'HEAD'])
    git(root, ['reset', '--hard', 'HEAD~1'])
    writeFileSync(join(root, 'proof.txt'), 'replacement\n')
    git(root, ['commit', '-am', 'replacement commit'])
    const reachableSha = git(root, ['rev-parse', 'HEAD'])

    expect(shaExistsOnBranch(orphanedSha, root)).toBe(false)
    expect(shaExistsOnBranch(reachableSha, root)).toBe(true)
  })
})

// ── #2116: a rebase rewrites every commit sha, silently invalidating every pinned
// evidence file. The test CONTENT is what a rebase preserves, so the blob sha is the
// rebase-stable pin the evidence can be re-resolved through.
describe('resolveEvidenceCommit rebase healing (#2116)', () => {
  const TEST_PATH = 'suite.test.ts'

  /** Repo with `main` (base) and a branch carrying a RED test commit, then rebased. */
  function seedRebasedRepo(): { root: string; preRebaseSha: string; blob: string } {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-evidence-rebase-'))
    roots.push(root)
    git(root, ['init', '--initial-branch=main'])
    git(root, ['config', 'user.name', 'Arbiter Test'])
    git(root, ['config', 'user.email', ['arbiter-test', 'example.invalid'].join('@')])
    writeFileSync(join(root, 'README.md'), 'base\n')
    git(root, ['add', 'README.md'])
    git(root, ['commit', '-m', 'base'])

    git(root, ['checkout', '-b', 'task/1'])
    writeFileSync(join(root, TEST_PATH), 'expect(thing()).toBe(1)\n')
    git(root, ['add', TEST_PATH])
    git(root, ['commit', '-m', 'test: red'])
    const preRebaseSha = git(root, ['rev-parse', 'HEAD'])
    const blob = git(root, ['rev-parse', `HEAD:${TEST_PATH}`])

    // main moves on, the branch is rebased onto it — same test content, new sha.
    git(root, ['checkout', 'main'])
    writeFileSync(join(root, 'README.md'), 'moved on\n')
    git(root, ['commit', '-am', 'chore: main moves'])
    git(root, ['checkout', 'task/1'])
    git(root, ['rebase', 'main'])

    return { root, preRebaseSha, blob }
  }

  it('heals a pinned sha orphaned by a rebase via the recorded test blob', () => {
    const { root, preRebaseSha, blob } = seedRebasedRepo()
    expect(shaExistsOnBranch(preRebaseSha, root)).toBe(false)

    const resolved = resolveEvidenceCommit(
      { test_commit_sha: preRebaseSha, test_path: TEST_PATH, test_blob_sha: blob },
      root,
    )
    expect(resolved).not.toBeNull()
    expect(resolved?.healed).toBe(true)
    expect(resolved?.sha).toBe(git(root, ['rev-parse', 'HEAD']))
  })

  it('returns the pinned sha unchanged, and healed=false, while it is still reachable', () => {
    const { root, blob } = seedRebasedRepo()
    const head = git(root, ['rev-parse', 'HEAD'])

    const resolved = resolveEvidenceCommit(
      { test_commit_sha: head, test_path: TEST_PATH, test_blob_sha: blob },
      root,
    )
    expect(resolved).toEqual({ sha: head, healed: false })
  })

  it('does not heal when the test content differs — that is a different RED', () => {
    const { root, preRebaseSha } = seedRebasedRepo()
    const resolved = resolveEvidenceCommit(
      { test_commit_sha: preRebaseSha, test_path: TEST_PATH, test_blob_sha: 'f'.repeat(40) },
      root,
    )
    expect(resolved).toBeNull()
  })

  it('cannot heal legacy evidence recorded without a blob pin', () => {
    const { root, preRebaseSha } = seedRebasedRepo()
    const resolved = resolveEvidenceCommit(
      { test_commit_sha: preRebaseSha, test_path: TEST_PATH },
      root,
    )
    expect(resolved).toBeNull()
  })
})
