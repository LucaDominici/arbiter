// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shaExistsOnBranch } from '../../src/evidence/git-checks.js'

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
