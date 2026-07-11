// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GENERATED_MANIFEST_FILE,
  loadGeneratedManifest,
  saveGeneratedManifest,
  loadUnwiredGuards,
  loadWithheldSafety,
  manifestKey,
} from '../../../src/state/generated-manifest.js'
import { FatalError } from '../../../src/utils/errors.js'

describe('generated-manifest', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-manifest-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('missing manifest → empty map (legit first run)', () => {
    expect(loadGeneratedManifest(dir)).toEqual({})
  })

  it('save then load round-trips the files map', () => {
    const files = { 'scripts/check-all.mjs': 'a'.repeat(64), 'b.txt': 'b'.repeat(64) }
    saveGeneratedManifest(dir, files)
    expect(existsSync(join(dir, GENERATED_MANIFEST_FILE))).toBe(true)
    expect(loadGeneratedManifest(dir)).toEqual(files)
  })

  it('orders file keys by codepoint, not locale collation (#1601)', () => {
    // A non-ASCII path key must land deterministically: codepoint order puts 'z' (U+007A)
    // before 'ö' (U+00F6), so `aö.txt` sorts AFTER `az.txt` regardless of the runtime LANG.
    const files = {
      'aö.txt': 'a'.repeat(64),
      'az.txt': 'b'.repeat(64),
      'az_b.txt': 'c'.repeat(64),
    }
    saveGeneratedManifest(dir, files)
    const raw = readFileSync(join(dir, GENERATED_MANIFEST_FILE), 'utf-8')
    const fileKeys = (JSON.parse(raw) as { files: Record<string, string> }).files
    expect(Object.keys(fileKeys)).toEqual(['az.txt', 'az_b.txt', 'aö.txt'])
  })

  it('saved manifest carries a $schemaVersion and no backup file is created', () => {
    saveGeneratedManifest(dir, { 'a.txt': 'a'.repeat(64) })
    const raw = JSON.parse(readFileSync(join(dir, GENERATED_MANIFEST_FILE), 'utf-8')) as {
      $schemaVersion: number
    }
    expect(raw.$schemaVersion).toBe(1)
    // A2/no-backup: deterministic file → never a .bak.* sibling
    saveGeneratedManifest(dir, { 'a.txt': 'c'.repeat(64) })
    const bak = `${GENERATED_MANIFEST_FILE}.bak`
    expect(existsSync(join(dir, bak))).toBe(false)
  })

  it('A5: unparseable manifest fails CLOSED with FatalError (exit 2), never coerced to empty', () => {
    writeFileSync(join(dir, GENERATED_MANIFEST_FILE), '{ this is not json ', 'utf-8')
    expect(() => loadGeneratedManifest(dir)).toThrow(FatalError)
  })

  it('unsupported $schemaVersion fails CLOSED with FatalError (future V2 not mis-parsed as V1)', () => {
    writeFileSync(
      join(dir, GENERATED_MANIFEST_FILE),
      JSON.stringify({ $schemaVersion: 2, files: { 'a.txt': 'a'.repeat(64) } }),
      'utf-8',
    )
    expect(() => loadGeneratedManifest(dir)).toThrow(FatalError)
  })

  it('valid-JSON-but-wrong-shape (missing files) fails CLOSED with FatalError', () => {
    writeFileSync(
      join(dir, GENERATED_MANIFEST_FILE),
      JSON.stringify({ $schemaVersion: 1 }),
      'utf-8',
    )
    expect(() => loadGeneratedManifest(dir)).toThrow(FatalError)
  })

  describe('unwiredGuards honest-status section (#1504/M1)', () => {
    const files = { 'scripts/check-anti-fake-green.mjs': 'a'.repeat(64) }

    it('records shipped-but-unwired guards as a distinct honest section, sorted+deduped', () => {
      saveGeneratedManifest(dir, files, [
        'scripts/check-min-test-execution.mjs',
        'scripts/check-anti-fake-green.mjs',
        'scripts/check-anti-fake-green.mjs', // dup
      ])
      expect(loadUnwiredGuards(dir)).toEqual([
        'scripts/check-anti-fake-green.mjs',
        'scripts/check-min-test-execution.mjs',
      ])
      // The guard is STILL tracked in files (for hash provenance) but the honest
      // section flags it as not-fully-delivered — the manifest no longer over-claims.
      expect(loadGeneratedManifest(dir)['scripts/check-anti-fake-green.mjs']).toBeDefined()
    })

    it('omits the section entirely when there is no gap (clean manifest stays byte-identical)', () => {
      saveGeneratedManifest(dir, files)
      const raw = readFileSync(join(dir, GENERATED_MANIFEST_FILE), 'utf-8')
      expect(raw).not.toContain('unwiredGuards')
      expect(loadUnwiredGuards(dir)).toEqual([])
    })

    it('clears a previously-recorded gap once the gate is wired (empty list omits the section)', () => {
      saveGeneratedManifest(dir, files, ['scripts/check-anti-fake-green.mjs'])
      expect(loadUnwiredGuards(dir)).toHaveLength(1)
      saveGeneratedManifest(dir, files, [])
      expect(loadUnwiredGuards(dir)).toEqual([])
    })

    it('missing manifest → empty unwired list (no false positive)', () => {
      expect(loadUnwiredGuards(dir)).toEqual([])
    })

    it('malformed unwiredGuards (non-string array) fails CLOSED, never silently dropped', () => {
      writeFileSync(
        join(dir, GENERATED_MANIFEST_FILE),
        JSON.stringify({ $schemaVersion: 1, files: {}, unwiredGuards: [42] }),
        'utf-8',
      )
      expect(() => loadUnwiredGuards(dir)).toThrow(FatalError)
      expect(() => loadGeneratedManifest(dir)).toThrow(FatalError)
    })

    it('unwiredGuards present as a valid string[] round-trips through loadGeneratedManifest too', () => {
      saveGeneratedManifest(dir, files, ['scripts/check-anti-fake-green.mjs'])
      // The files map still loads cleanly (the honest section does not break it).
      expect(loadGeneratedManifest(dir)).toEqual(files)
    })
  })

  describe('withheldSafety honest-status section (T1, mirrors unwiredGuards)', () => {
    const files = { '.claude/hooks/stop-dangerous.mjs': 'a'.repeat(64) }

    it('records withheld safety-class files as a distinct honest section, sorted+deduped', () => {
      saveGeneratedManifest(
        dir,
        files,
        [],
        [
          '.claude/hooks/stop-dangerous.mjs',
          '.claude/hooks/enforce-read-only.mjs',
          '.claude/hooks/enforce-read-only.mjs', // dup
        ],
      )
      expect(loadWithheldSafety(dir)).toEqual([
        '.claude/hooks/enforce-read-only.mjs',
        '.claude/hooks/stop-dangerous.mjs',
      ])
      expect(loadGeneratedManifest(dir)['.claude/hooks/stop-dangerous.mjs']).toBeDefined()
    })

    it('omits the section entirely when there is no gap (clean manifest stays byte-identical)', () => {
      saveGeneratedManifest(dir, files)
      const raw = readFileSync(join(dir, GENERATED_MANIFEST_FILE), 'utf-8')
      expect(raw).not.toContain('withheldSafety')
      expect(loadWithheldSafety(dir)).toEqual([])
    })

    it('clears a previously-recorded gap once the file is re-adopted (empty list omits the section)', () => {
      saveGeneratedManifest(dir, files, [], ['.claude/hooks/stop-dangerous.mjs'])
      expect(loadWithheldSafety(dir)).toHaveLength(1)
      saveGeneratedManifest(dir, files, [], [])
      expect(loadWithheldSafety(dir)).toEqual([])
    })

    it('missing manifest → empty withheldSafety list (no false positive)', () => {
      expect(loadWithheldSafety(dir)).toEqual([])
    })

    it('malformed withheldSafety (non-string array) fails CLOSED, never silently dropped', () => {
      writeFileSync(
        join(dir, GENERATED_MANIFEST_FILE),
        JSON.stringify({ $schemaVersion: 1, files: {}, withheldSafety: [42] }),
        'utf-8',
      )
      expect(() => loadWithheldSafety(dir)).toThrow(FatalError)
      expect(() => loadGeneratedManifest(dir)).toThrow(FatalError)
    })

    it('unwiredGuards and withheldSafety coexist independently in the same manifest', () => {
      saveGeneratedManifest(
        dir,
        files,
        ['scripts/check-anti-fake-green.mjs'],
        ['.claude/hooks/stop-dangerous.mjs'],
      )
      expect(loadUnwiredGuards(dir)).toEqual(['scripts/check-anti-fake-green.mjs'])
      expect(loadWithheldSafety(dir)).toEqual(['.claude/hooks/stop-dangerous.mjs'])
    })
  })

  describe('manifestKey (A7 posix normalization + containment)', () => {
    it('returns a posix-relative key for a file under targetDir', () => {
      expect(manifestKey(dir, join(dir, 'scripts', 'check-all.mjs'))).toBe('scripts/check-all.mjs')
    })

    it('normalizes backslash-bearing relative input to forward slashes', () => {
      // Simulate a Windows-style relative fragment joined under the dir.
      const key = manifestKey(dir, join(dir, 'scripts\\check-all.mjs'))
      expect(key).not.toContain('\\')
      expect(key).toBe('scripts/check-all.mjs')
    })

    it('returns null for a path that escapes targetDir (..) — never crashes', () => {
      expect(manifestKey(dir, join(dir, '..', 'outside.txt'))).toBeNull()
    })
  })
})
