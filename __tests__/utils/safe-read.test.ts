// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSafe, readPackageJsonSafe } from '../../src/utils/safe-read.js'
import { createTestProject, cleanupTestProject } from '../helpers.js'

describe('readFileSafe (#684)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns file content on success', () => {
    const p = join(dir, 'hello.txt')
    writeFileSync(p, 'world', 'utf-8')
    expect(readFileSafe(p)).toBe('world')
  })

  it('returns "" for ENOENT without warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(readFileSafe(join(dir, 'nonexistent.txt'))).toBe('')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('returns "" and warns on non-ENOENT error', () => {
    // #2288: a chmod-000 file is still readable BY ROOT, so the permission-based
    // form of this test silently stopped exercising the warn branch on the CI
    // runner (which runs as root) — a coverage hole visible only in CI. Reading a
    // DIRECTORY fails with EISDIR for every uid, root included, so the non-ENOENT
    // branch is now exercised deterministically wherever the suite runs.
    const p = join(dir, 'locked-dir')
    mkdirSync(p)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(readFileSafe(p)).toBe('')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('locked-dir'))
    spy.mockRestore()
  })
})

describe('readPackageJsonSafe (#684)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns parsed object for valid package.json', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', version: '1.0.0' }))
    expect(readPackageJsonSafe(dir)).toEqual({ name: 'my-app', version: '1.0.0' })
  })

  it('returns {} for ENOENT without warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sub = join(dir, 'no-such-dir')
    mkdirSync(sub)
    expect(readPackageJsonSafe(sub)).toEqual({})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('returns {} and warns on invalid JSON', () => {
    writeFileSync(join(dir, 'package.json'), '{invalid')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(readPackageJsonSafe(dir)).toEqual({})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('package.json'))
    spy.mockRestore()
  })
})
