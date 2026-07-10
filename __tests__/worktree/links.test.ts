import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  readlinkSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { materializeLink, checkLinkIntegrity } from '../../src/worktree/links.js'
import type { WorktreeLinkSpec } from '../../src/wizard/types.js'

let mainRepo: string
let worktree: string

beforeEach(() => {
  mainRepo = mkdtempSync(join(tmpdir(), 'arbiter-links-main-'))
  worktree = mkdtempSync(join(tmpdir(), 'arbiter-links-wt-'))
})

afterEach(() => {
  rmSync(mainRepo, { recursive: true, force: true })
  rmSync(worktree, { recursive: true, force: true })
})

describe('materializeLink', () => {
  it('returns LINKED and creates an absolute symlink when source exists', () => {
    writeFileSync(join(mainRepo, '.env'), 'SECRET=1')

    const spec: WorktreeLinkSpec = { path: '.env' }
    const result = materializeLink(spec, mainRepo, worktree)

    expect(result.result).toBe('LINKED')
    const linkPath = join(worktree, '.env')
    const stat = lstatSync(linkPath)
    expect(stat.isSymbolicLink()).toBe(true)
    // Symlink target must be absolute
    const target = readlinkSync(linkPath)
    expect(target).toBe(resolve(mainRepo, '.env'))
  })

  it('returns COPIED_TEMPLATE and copies the template when source is missing but template exists', () => {
    writeFileSync(join(mainRepo, '.env.example'), 'SECRET=')

    const spec: WorktreeLinkSpec = { path: '.env', template: '.env.example' }
    const result = materializeLink(spec, mainRepo, worktree)

    expect(result.result).toBe('COPIED_TEMPLATE')
    expect(existsSync(join(worktree, '.env'))).toBe(true)
    // Copied file is NOT a symlink
    expect(lstatSync(join(worktree, '.env')).isSymbolicLink()).toBe(false)
  })

  it('returns MISSING when source and template are both absent and required is falsy', () => {
    const spec: WorktreeLinkSpec = { path: '.env', required: false }
    const result = materializeLink(spec, mainRepo, worktree)
    expect(result.result).toBe('MISSING')
  })

  it('throws when source is absent and required is true', () => {
    const spec: WorktreeLinkSpec = { path: '.env.required', required: true }
    expect(() => materializeLink(spec, mainRepo, worktree)).toThrow(/required.*missing/i)
  })

  it('creates parent directories as needed', () => {
    mkdirSync(join(mainRepo, '.claude'))
    writeFileSync(join(mainRepo, '.claude', 'settings.local.json'), '{}')

    const spec: WorktreeLinkSpec = { path: '.claude/settings.local.json' }
    const result = materializeLink(spec, mainRepo, worktree)

    expect(result.result).toBe('LINKED')
    expect(existsSync(join(worktree, '.claude', 'settings.local.json'))).toBe(true)
  })

  it('is idempotent — skips if link already exists at destination', () => {
    writeFileSync(join(mainRepo, '.env'), 'SECRET=1')
    const spec: WorktreeLinkSpec = { path: '.env' }

    materializeLink(spec, mainRepo, worktree) // first call
    const result = materializeLink(spec, mainRepo, worktree) // second call

    expect(result.result).toBe('LINKED')
  })
})

describe('checkLinkIntegrity', () => {
  it('returns empty array when all symlinks resolve correctly', () => {
    writeFileSync(join(mainRepo, '.env'), 'SECRET=1')
    const spec: WorktreeLinkSpec = { path: '.env' }
    materializeLink(spec, mainRepo, worktree)

    const dangling = checkLinkIntegrity([spec], worktree)
    expect(dangling).toHaveLength(0)
  })

  it('detects a dangling symlink when the target has been removed', () => {
    const envPath = join(mainRepo, '.env')
    writeFileSync(envPath, 'SECRET=1')
    const spec: WorktreeLinkSpec = { path: '.env' }
    materializeLink(spec, mainRepo, worktree)

    // Remove the target so the symlink dangles
    rmSync(envPath)

    const dangling = checkLinkIntegrity([spec], worktree)
    expect(dangling).toHaveLength(1)
    expect(dangling[0]).toMatch(/\.env/)
  })

  it('ignores entries that are not symlinks', () => {
    // Write a regular file at the link destination path
    writeFileSync(join(worktree, '.env'), 'not a symlink')
    const spec: WorktreeLinkSpec = { path: '.env' }

    const dangling = checkLinkIntegrity([spec], worktree)
    expect(dangling).toHaveLength(0)
  })

  it('ignores absent entries (link was never created)', () => {
    const spec: WorktreeLinkSpec = { path: '.env' }
    const dangling = checkLinkIntegrity([spec], worktree)
    expect(dangling).toHaveLength(0)
  })

  it('resolves relative symlink targets against link directory not process.cwd() (#327)', () => {
    // Create the real target file in mainRepo
    writeFileSync(join(mainRepo, 'settings.json'), '{}')

    // Manually create a relative symlink at worktree/settings.json -> ../mainRepo/settings.json
    // This simulates a symlink with a relative target (not created by materializeLink,
    // which always uses absolute targets).
    const linkPath = join(worktree, 'settings.json')
    const relTarget = relative(worktree, join(mainRepo, 'settings.json'))
    symlinkSync(relTarget, linkPath)

    const spec: WorktreeLinkSpec = { path: 'settings.json' }
    const dangling = checkLinkIntegrity([spec], worktree)

    // Target exists when resolved relative to the link's parent — NOT dangling
    expect(dangling).toHaveLength(0)
  })
})

describe('materializeLink — directory type', () => {
  it('returns LINKED_DIR and creates a symlink when type is directory and source exists', () => {
    mkdirSync(join(mainRepo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}')
    writeFileSync(join(mainRepo, 'node_modules', 'marker.txt'), 'exists')

    const spec: WorktreeLinkSpec = { path: 'node_modules', type: 'directory' }
    const result = materializeLink(spec, mainRepo, worktree)

    expect(result.result).toBe('LINKED_DIR')
    const linkPath = join(worktree, 'node_modules')
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linkPath)).toBe(resolve(mainRepo, 'node_modules'))
  })

  it('returns COPIED_DIR and copies recursively when type is directory and strategy is copy', () => {
    mkdirSync(join(mainRepo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}')

    const spec: WorktreeLinkSpec = {
      path: 'node_modules',
      type: 'directory',
      strategy: 'copy',
    }
    const result = materializeLink(spec, mainRepo, worktree)

    expect(result.result).toBe('COPIED_DIR')
    const copiedPath = join(worktree, 'node_modules')
    expect(lstatSync(copiedPath).isSymbolicLink()).toBe(false)
    expect(existsSync(join(copiedPath, 'pkg', 'index.js'))).toBe(true)
  })

  it('returns MISSING when type is directory, source absent, and required is falsy', () => {
    const spec: WorktreeLinkSpec = {
      path: 'node_modules',
      type: 'directory',
      required: false,
    }
    const result = materializeLink(spec, mainRepo, worktree)
    expect(result.result).toBe('MISSING')
  })

  it('throws when type is directory, source absent, and required is true', () => {
    const spec: WorktreeLinkSpec = {
      path: 'node_modules',
      type: 'directory',
      required: true,
    }
    expect(() => materializeLink(spec, mainRepo, worktree)).toThrow(/required directory missing/i)
  })

  it('throws when type is directory but source is a file, not a directory', () => {
    writeFileSync(join(mainRepo, 'node_modules'), 'not a directory')
    const spec: WorktreeLinkSpec = { path: 'node_modules', type: 'directory' }
    expect(() => materializeLink(spec, mainRepo, worktree)).toThrow(/expected directory/i)
  })

  it('is idempotent — skips if destination already exists (directory symlink)', () => {
    mkdirSync(join(mainRepo, 'node_modules'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', 'marker.txt'), 'exists')

    const spec: WorktreeLinkSpec = { path: 'node_modules', type: 'directory' }
    materializeLink(spec, mainRepo, worktree) // first call
    const result = materializeLink(spec, mainRepo, worktree) // second call
    expect(result.result).toBe('LINKED_DIR')
  })
})

// #1873 T4 (M1): whole-dir node_modules symlinks share Vite/esbuild caches
// (node_modules/.vite, node_modules/.cache) across ALL worktrees — N
// concurrent builds corrupt them into non-deterministic spurious reds. The
// symlink-children strategy symlinks each top-level child EXCEPT the cache
// dirs, which each worktree creates locally.
describe('materializeLink — symlink-children strategy (#1873 T4)', () => {
  function seedNodeModules(): void {
    mkdirSync(join(mainRepo, 'node_modules', 'pkg-a'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', 'pkg-a', 'index.js'), 'module.exports = {}')
    mkdirSync(join(mainRepo, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', '.bin', 'tool'), '#!/bin/sh')
    mkdirSync(join(mainRepo, 'node_modules', '.vite', 'deps'), { recursive: true })
    writeFileSync(join(mainRepo, 'node_modules', '.vite', 'deps', 'chunk.js'), 'cache')
    mkdirSync(join(mainRepo, 'node_modules', '.cache'), { recursive: true })
  }

  const spec: WorktreeLinkSpec = {
    path: 'node_modules',
    type: 'directory',
    strategy: 'symlink-children',
  }

  it('symlinks each top-level child, EXCLUDING .vite and .cache', () => {
    seedNodeModules()

    const result = materializeLink(spec, mainRepo, worktree)
    expect(result.result).toBe('LINKED_CHILDREN')

    const dest = join(worktree, 'node_modules')
    // The dest itself is a REAL directory (writable per-worktree).
    expect(lstatSync(dest).isSymbolicLink()).toBe(false)
    expect(lstatSync(dest).isDirectory()).toBe(true)
    // Non-cache children are absolute symlinks into the main repo.
    expect(lstatSync(join(dest, 'pkg-a')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(dest, 'pkg-a'))).toBe(resolve(mainRepo, 'node_modules', 'pkg-a'))
    expect(lstatSync(join(dest, '.bin')).isSymbolicLink()).toBe(true)
    // Cache dirs are NOT shared: absent in the worktree.
    expect(existsSync(join(dest, '.vite'))).toBe(false)
    expect(existsSync(join(dest, '.cache'))).toBe(false)
  })

  it('leaves the local cache dir location writable per worktree', () => {
    seedNodeModules()
    materializeLink(spec, mainRepo, worktree)

    // A tool creating its cache inside the worktree's node_modules writes a
    // LOCAL dir — not through a symlink into the shared main-repo cache.
    const localVite = join(worktree, 'node_modules', '.vite')
    mkdirSync(localVite, { recursive: true })
    writeFileSync(join(localVite, 'probe'), 'local')
    expect(existsSync(join(mainRepo, 'node_modules', '.vite', 'probe'))).toBe(false)
  })

  it('is idempotent and heals missing child links on re-run', () => {
    seedNodeModules()
    materializeLink(spec, mainRepo, worktree)

    // A new dependency appears in the main repo after the first materialize.
    mkdirSync(join(mainRepo, 'node_modules', 'pkg-b'), { recursive: true })
    const result = materializeLink(spec, mainRepo, worktree)
    expect(result.result).toBe('LINKED_CHILDREN')
    expect(lstatSync(join(worktree, 'node_modules', 'pkg-b')).isSymbolicLink()).toBe(true)
    // Still no cache leak.
    expect(existsSync(join(worktree, 'node_modules', '.vite'))).toBe(false)
  })

  it('refuses to convert a whole-dir symlink dest left by the old strategy', () => {
    seedNodeModules()
    materializeLink({ path: 'node_modules', type: 'directory' }, mainRepo, worktree)
    expect(() => materializeLink(spec, mainRepo, worktree)).toThrow(/symlink|remove/i)
  })

  it('returns MISSING when source absent and required falsy; throws when required', () => {
    expect(materializeLink(spec, mainRepo, worktree).result).toBe('MISSING')
    expect(() =>
      materializeLink({ ...spec, required: true }, mainRepo, worktree),
    ).toThrow(/required directory missing/i)
  })

  it('checkLinkIntegrity flags dangling CHILD symlinks under symlink-children', () => {
    seedNodeModules()
    materializeLink(spec, mainRepo, worktree)

    // Remove a source package → its child symlink dangles.
    rmSync(join(mainRepo, 'node_modules', 'pkg-a'), { recursive: true, force: true })
    const dangling = checkLinkIntegrity([spec], worktree)
    expect(dangling).toHaveLength(1)
    expect(dangling[0]).toMatch(/pkg-a/)
  })

  it('regression: plain symlink and copy strategies are unchanged', () => {
    seedNodeModules()
    const plain = materializeLink({ path: 'node_modules', type: 'directory' }, mainRepo, worktree)
    expect(plain.result).toBe('LINKED_DIR')
    expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(true)

    const wt2 = mkdtempSync(join(tmpdir(), 'arbiter-links-wt2-'))
    try {
      const copied = materializeLink(
        { path: 'node_modules', type: 'directory', strategy: 'copy' },
        mainRepo,
        wt2,
      )
      expect(copied.result).toBe('COPIED_DIR')
      // copy keeps EVERYTHING, caches included (pre-existing semantics).
      expect(existsSync(join(wt2, 'node_modules', '.vite'))).toBe(true)
    } finally {
      rmSync(wt2, { recursive: true, force: true })
    }
  })
})
