// SPDX-License-Identifier: Apache-2.0
// #2399 — evidence is bound to SOURCE CONTENT, not to an exact HEAD sha: an
// evidence-only commit (anything under .arbiter/ or .agents/) must keep the
// evidence it just recorded valid, while a source change must invalidate it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { evidenceStaleness, isForeignSidecar } from '../../scripts/lib/evidence-binding.mjs'

let repo: string

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf-8' },
  ).trim()
}

function commit(path: string, content: string, message: string): string {
  const abs = join(repo, path)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  git('add', '-A')
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'evidence-binding-'))
  execFileSync('git', ['init', '-q', '-b', 'task/#2399-evidence-binding'], {
    cwd: repo,
    stdio: 'ignore',
  })
  commit('src/app.ts', 'export const a = 1\n', 'base')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('evidenceStaleness', () => {
  it('accepts evidence recorded at HEAD', () => {
    expect(evidenceStaleness(repo, git('rev-parse', 'HEAD'))).toBeNull()
  })

  it('accepts evidence after an evidence-only commit (the #2399 defect)', () => {
    const recorded = git('rev-parse', 'HEAD')
    commit('.arbiter/evidence/cross-model/_2399/dispatch.json', '{}\n', 'evidence refresh')
    commit('.agents/plan/PLAN.json', '{}\n', 'plan refresh')
    expect(evidenceStaleness(repo, recorded)).toBeNull()
  })

  it('rejects evidence once a source file changed, naming the sha', () => {
    const recorded = git('rev-parse', 'HEAD')
    commit('src/app.ts', 'export const a = 2\n', 'source change')
    expect(evidenceStaleness(repo, recorded)).toBe(`source changed since ${recorded.slice(0, 7)}`)
  })

  it('rejects a sha that is not an ancestor of HEAD', () => {
    const recorded = git('rev-parse', 'HEAD')
    git('checkout', '-q', '-b', 'other')
    commit('src/app.ts', 'export const a = 3\n', 'divergent')
    const divergent = git('rev-parse', 'HEAD')
    git('checkout', '-q', 'task/#2399-evidence-binding')
    expect(evidenceStaleness(repo, divergent)).toBe(
      `sha ${divergent.slice(0, 7)} is not an ancestor of HEAD`,
    )
    expect(evidenceStaleness(repo, recorded)).toBeNull()
  })

  it('rejects a sha that does not resolve', () => {
    expect(evidenceStaleness(repo, 'deadbeef')).toMatch(/does not resolve/)
  })

  it('rejects missing or blank sha values', () => {
    expect(evidenceStaleness(repo, '')).toMatch(/sha/i)
    expect(evidenceStaleness(repo, undefined)).toMatch(/sha/i)
  })

  it('rejects a branch mismatch when a branch is required', () => {
    const recorded = git('rev-parse', 'HEAD')
    expect(evidenceStaleness(repo, recorded, { branch: 'task/#2399-evidence-binding' })).toBeNull()
    expect(evidenceStaleness(repo, recorded, { branch: 'task/#1111-other' })).toBe(
      'branch mismatch: evidence is for task/#1111-other, checkout is on task/#2399-evidence-binding',
    )
  })

  it('honours a custom exclude list', () => {
    const recorded = git('rev-parse', 'HEAD')
    commit('notes/scratch.md', 'x\n', 'notes')
    expect(evidenceStaleness(repo, recorded)).toMatch(/source changed/)
    expect(evidenceStaleness(repo, recorded, { excludes: ['notes'] })).toBeNull()
  })
})

describe('isForeignSidecar', () => {
  it('is true when the sidecar belongs to another task', () => {
    expect(isForeignSidecar({ taskId: '#2354' }, '#2399')).toBe(true)
    expect(isForeignSidecar({ task: '#2354' }, '#2399')).toBe(true)
  })

  it('is false for the active task', () => {
    expect(isForeignSidecar({ taskId: '#2399' }, '#2399')).toBe(false)
    expect(isForeignSidecar({ task: '#2399' }, '#2399')).toBe(false)
  })

  it('is false when either side declares no task (not provably foreign)', () => {
    expect(isForeignSidecar({ count: 1 }, '#2399')).toBe(false)
    expect(isForeignSidecar({ taskId: '#2354' }, undefined)).toBe(false)
    expect(isForeignSidecar({ taskId: '#2354' }, '')).toBe(false)
    expect(isForeignSidecar(null, '#2399')).toBe(false)
  })
})
