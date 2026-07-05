// SPDX-License-Identifier: Apache-2.0
// TDD test for #1241: wiki query Q&A mode returns cited results
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const GEN = join(root, 'scripts', 'gen-wiki.mjs')
const WIKI = join(root, 'wiki')

describe('gen-wiki.mjs query — Q&A mode (#1241)', () => {
  // wiki/ is generated output, gitignored since the docs/#1770 public split
  // (T7: generator stays, output no longer committed). Build it fresh here
  // instead of assuming a prior commit/checkout already populated it.
  beforeAll(() => {
    if (!existsSync(WIKI)) {
      spawnSync('node', [GEN], { cwd: root })
    }
  })

  it('wiki/ directory exists (gen-wiki.mjs has been run)', () => {
    expect(existsSync(WIKI)).toBe(true)
  })

  it('query "CANON governance" returns top results with source citations', () => {
    const result = spawnSync('node', [GEN, 'query', 'CANON governance'], {
      encoding: 'utf-8',
      cwd: root,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Top results for "CANON governance"/)
    expect(result.stdout).toMatch(/Source:/)
  })

  it('query returns pages with .md filenames', () => {
    const result = spawnSync('node', [GEN, 'query', 'invariant enforcement'], {
      encoding: 'utf-8',
      cwd: root,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/\.md/)
  })

  it('query with no matching terms exits 0 and says no results', () => {
    const result = spawnSync('node', [GEN, 'query', 'xyzzy1234notarealterm'], {
      encoding: 'utf-8',
      cwd: root,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/No wiki pages match/)
  })
})
