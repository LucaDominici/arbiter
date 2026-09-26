// SPDX-License-Identifier: Apache-2.0
/**
 * #2912 round-2 fixes. F1: the branch scan (no --task) skips another task's unreadable,
 * malformed or directory entry instead of failing every check, while the checked task's own
 * malformed file still fails closed. F3: rebinding a task deletes the legacy sidecar it names.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { invalidateTaskReceipts } from '../../src/commands/task-state.js'

const CHECK = new URL('../../scripts/check-review-completion.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname
const BRANCH = 'task/#2914-r2'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-sidecar-2912-r2-'))
  roots.push(root)
  return root
}

/** A committed repo on BRANCH whose sidecar directory holds the given raw entries. */
function repoWithSidecars(entries: Record<string, string | null>): { root: string; sha: string } {
  const root = tempRoot()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', BRANCH)
  git('-c', 'user.email=f.invalid', '-c', 'user.name=F', 'commit', '-q', '--allow-empty', '-m', 's')
  const dir = join(root, '.arbiter', 'agents-dispatched')
  mkdirSync(dir, { recursive: true })
  for (const [name, raw] of Object.entries(entries)) {
    if (raw === null) mkdirSync(join(dir, name))
    else writeFileSync(join(dir, name), raw)
  }
  return { root, sha: git('rev-parse', 'HEAD').trim() }
}

function runCheck(root: string, ...extra: string[]) {
  const result = spawnSync(
    process.execPath,
    [CHECK, ...extra, `--schema=${SCHEMA}`, '--repo-root', root],
    { cwd: root, encoding: 'utf8' },
  )
  return { exitCode: result.status ?? 1, out: `${result.stdout}${result.stderr}` }
}

function ownSidecar(sha: string): string {
  return JSON.stringify({ count: 1, agents: ['domain'], taskId: '#2914', branch: BRANCH, sha })
}

describe('#2912 round 2', () => {
  it('F1: a malformed or directory sidecar of another task does not break the branch scan', () => {
    const { root, sha } = repoWithSidecars({ '_9999.json': '{bad', '_9998.json': null })
    writeFileSync(join(root, '.arbiter', 'agents-dispatched', '_2914.json'), ownSidecar(sha))
    const result = runCheck(root)
    expect(result.out).not.toMatch(/cannot scan dispatch sidecars/)
    // The branch's own sidecar was selected: its reviewer is judged, not skipped as vacuous.
    expect(result.exitCode, result.out).toBe(1)
    expect(result.out).toMatch(/domain: missing return envelope/)
  })

  it('F1: the checked task’s own malformed sidecar still fails closed', () => {
    const { root } = repoWithSidecars({ '_2914.json': '{bad' })
    const result = runCheck(root, '--task', '#2914')
    expect(result.exitCode, result.out).not.toBe(0)
    expect(result.out).toMatch(/_2914\.json/)
  })

  it('F3: rebinding deletes the legacy sidecar that names this task, and keeps a foreign one', () => {
    for (const [owner, kept] of [
      ['#2912', false],
      ['#2911', true],
    ] as const) {
      const root = tempRoot()
      const legacy = join(root, '.arbiter', 'agents-dispatched.json')
      mkdirSync(join(root, '.arbiter'), { recursive: true })
      writeFileSync(legacy, JSON.stringify({ taskId: owner }))
      invalidateTaskReceipts(root, '#2912')
      expect(existsSync(legacy), owner).toBe(kept)
    }
  })
})
