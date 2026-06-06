// SPDX-License-Identifier: Apache-2.0
// TDD gate test for #1241: LLM-Wiki lint gate planted-break fixtures
// Four dimensions: broken-link | orphan | stale | no-citation
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const CHECK = join(root, 'scripts', 'check-wiki-lint.mjs')
const FIXTURES = join(root, '__tests__', 'fixtures', 'wiki-lint')

function runLint(fixtureDir: string): { status: number; output: string } {
  const result = spawnSync('node', [CHECK, '--wiki-dir', join(FIXTURES, fixtureDir, 'wiki')], {
    encoding: 'utf-8',
    cwd: root,
  })
  return {
    status: result.status ?? 1,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  }
}

describe('check-wiki-lint.mjs — planted-break fixtures (#1241)', () => {
  it('exits 1 on broken wikilink (broken-link fixture)', () => {
    const { status, output } = runLint('broken-link')
    expect(status, `expected exit 1 but got ${status}. Output:\n${output}`).toBe(1)
    expect(output).toMatch(/broken.link|broken link|nonexistent|NonExistentPage/i)
  })

  it('exits 1 on orphan page (orphan fixture)', () => {
    const { status, output } = runLint('orphan')
    expect(status, `expected exit 1 but got ${status}. Output:\n${output}`).toBe(1)
    expect(output).toMatch(/orphan/i)
  })

  it('exits 1 on stale source_sha (stale fixture)', () => {
    const { status, output } = runLint('stale')
    expect(status, `expected exit 1 but got ${status}. Output:\n${output}`).toBe(1)
    expect(output).toMatch(/stale|sha|hash/i)
  })

  it('exits 1 on missing source citation (no-citation fixture)', () => {
    const { status, output } = runLint('no-citation')
    expect(status, `expected exit 1 but got ${status}. Output:\n${output}`).toBe(1)
    expect(output).toMatch(/citation|source/i)
  })
})
