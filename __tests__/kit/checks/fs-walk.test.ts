// SPDX-License-Identifier: Apache-2.0
// Shared fs-walk helper backing the A9/A10 opt-in kit checks (real fs, tmp dir per test).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { walkFiles } from '../../../src/kit/checks/fs-walk.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-fs-walk-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('walkFiles', () => {
  it('finds files recursively', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'top.sql'), '')
    writeFileSync(join(root, 'a', 'b', 'nested.sql'), '')

    const found = walkFiles(root, { extensions: ['.sql'] })
    expect(found).toHaveLength(2)
  })

  it('filters by extension', () => {
    writeFileSync(join(root, 'keep.sql'), '')
    writeFileSync(join(root, 'skip.txt'), '')

    const found = walkFiles(root, { extensions: ['.sql'] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('keep.sql')
  })

  it('returns all files when no extension filter is given', () => {
    writeFileSync(join(root, 'a.sql'), '')
    writeFileSync(join(root, 'b.txt'), '')

    const found = walkFiles(root)
    expect(found).toHaveLength(2)
  })

  it('skips default-ignored directories (e.g. node_modules)', () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'dep.sql'), '')
    writeFileSync(join(root, 'real.sql'), '')

    const found = walkFiles(root, { extensions: ['.sql'] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('real.sql')
  })

  it('returns an empty array for a non-existent root', () => {
    const found = walkFiles(join(root, 'does-not-exist'))
    expect(found).toEqual([])
  })
})
