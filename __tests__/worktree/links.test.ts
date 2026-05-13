import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  readlinkSync,
  existsSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
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
