// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import {
  readFileSafe,
  readPackageJsonSafe,
  readBaselineFileSafe,
} from '../../src/utils/safe-read.js'
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

describe('readBaselineFileSafe (#1264)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns the parsed object for a valid baseline', () => {
    const p = join(dir, 'baseline.json')
    writeFileSync(p, JSON.stringify({ 'a.mjs': 12, 'b.mjs': 34 }))
    expect(readBaselineFileSafe(p)).toEqual({ 'a.mjs': 12, 'b.mjs': 34 })
  })

  it('returns null when the baseline file is absent (no warning)', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(readBaselineFileSafe(join(dir, 'missing.json'))).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('returns null and warns to stderr on invalid JSON', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, '{ not json')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(readBaselineFileSafe(p)).toBeNull()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'))
    spy.mockRestore()
  })

  it('returns null and warns when the top level is an array', () => {
    const p = join(dir, 'arr.json')
    writeFileSync(p, JSON.stringify([1, 2, 3]))
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(readBaselineFileSafe(p)).toBeNull()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unexpected structure'))
    spy.mockRestore()
  })
})
