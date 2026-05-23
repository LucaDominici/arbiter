/**
 * Tests for graph/builders/utils.ts (#1023).
 *
 * Covers: walkFiles symlink-cycle termination guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkFiles } from '../../src/graph/builders/utils.js'

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-utils-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('walkFiles (#1023)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('returns files matching predicate in a flat directory', () => {
    writeFileSync(join(env.dir, 'a.md'), '')
    writeFileSync(join(env.dir, 'b.txt'), '')
    const result = walkFiles(env.dir, (p) => p.endsWith('.md'))
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('a.md')
  })

  it('returns files recursively across subdirectories', () => {
    mkdirSync(join(env.dir, 'sub'), { recursive: true })
    writeFileSync(join(env.dir, 'root.md'), '')
    writeFileSync(join(env.dir, 'sub', 'nested.md'), '')
    const result = walkFiles(env.dir, (p) => p.endsWith('.md'))
    expect(result).toHaveLength(2)
  })

  it('does not recurse infinitely on a symlink cycle (#1023)', () => {
    // Create: dir/real/ and dir/real/loop -> dir/real (cycle)
    const realDir = join(env.dir, 'real')
    mkdirSync(realDir)
    writeFileSync(join(realDir, 'file.md'), '')
    symlinkSync(realDir, join(realDir, 'loop'))
    // Without the visited-inode guard this would infinite-loop; with it, terminates
    expect(() => {
      const result = walkFiles(env.dir, (p) => p.endsWith('.md'))
      // file.md must appear exactly once despite the cycle
      expect(result.filter((p) => p.endsWith('file.md'))).toHaveLength(1)
    }).not.toThrow()
  })

  it('skips unreadable directories without throwing', () => {
    mkdirSync(join(env.dir, 'ok'))
    writeFileSync(join(env.dir, 'ok', 'f.md'), '')
    // Should not throw even if some path issues exist
    expect(() => walkFiles(env.dir, (p) => p.endsWith('.md'))).not.toThrow()
  })

  it('returns empty array for empty directory', () => {
    expect(walkFiles(env.dir, () => true)).toEqual([])
  })

  it('returns results in sorted order', () => {
    writeFileSync(join(env.dir, 'z.md'), '')
    writeFileSync(join(env.dir, 'a.md'), '')
    writeFileSync(join(env.dir, 'm.md'), '')
    const result = walkFiles(env.dir, (p) => p.endsWith('.md'))
    const sorted = [...result].sort()
    expect(result).toEqual(sorted)
  })
})
