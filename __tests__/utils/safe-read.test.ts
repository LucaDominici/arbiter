// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
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
    // Skip on CI where processes may run as root (root ignores chmod)
    if (process.getuid?.() === 0) return
    const p = join(dir, 'locked.txt')
    writeFileSync(p, 'secret', 'utf-8')
    chmodSync(p, 0o000)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(readFileSafe(p)).toBe('')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('locked.txt'))
    spy.mockRestore()
    chmodSync(p, 0o644)
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
