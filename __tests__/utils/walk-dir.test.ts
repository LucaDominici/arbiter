import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkDir } from '../../src/utils/walk-dir.js'

describe('walkDir', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arbiter-walkdir-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('collects all files recursively as absolute paths by default', () => {
    writeFileSync(join(root, 'a.txt'), '')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.txt'), '')
    const out = walkDir(root)
    expect(out.sort()).toEqual([join(root, 'a.txt'), join(root, 'sub', 'b.txt')].sort())
  })

  it('returns POSIX-relative paths when a base is given', () => {
    writeFileSync(join(root, 'a.txt'), '')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.txt'), '')
    const out = walkDir(root, { base: root })
    expect(out.map((p) => p.replace(/\\/g, '/')).sort()).toEqual(['a.txt', 'sub/b.txt'])
  })

  it('prunes skipDirs (does not descend)', () => {
    writeFileSync(join(root, 'keep.txt'), '')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'dep.txt'), '')
    const out = walkDir(root, { base: root, skipDirs: new Set(['node_modules', '.git']) })
    expect(out.map((p) => p.replace(/\\/g, '/'))).toEqual(['keep.txt'])
  })

  it('applies a file filter predicate', () => {
    writeFileSync(join(root, 'keep.bak'), '')
    writeFileSync(join(root, 'drop.txt'), '')
    const out = walkDir(root, { base: root, filter: (name) => name.endsWith('.bak') })
    expect(out.map((p) => p.replace(/\\/g, '/'))).toEqual(['keep.bak'])
  })

  it('terminates on a directory symlink cycle (does not follow symlinks)', () => {
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real', 'f.txt'), '')
    // Symlink pointing back at the walk root — would infinite-loop a stat-following walker.
    symlinkSync(root, join(root, 'real', 'loop'), 'dir')
    const out = walkDir(root, { base: root })
    // The symlink leaf is neither recursed into nor collected (Dirent: not a file, not a dir).
    expect(out.map((p) => p.replace(/\\/g, '/'))).toEqual(['real/f.txt'])
  })

  it('swallows unreadable directories by default (errorMode "swallow")', () => {
    const out = walkDir(join(root, 'does-not-exist'))
    expect(out).toEqual([])
  })

  it('errorMode "fs-soft" swallows ENOENT on a missing root', () => {
    const out = walkDir(join(root, 'missing'), { errorMode: 'fs-soft' })
    expect(out).toEqual([])
  })
})
