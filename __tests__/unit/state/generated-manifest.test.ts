// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GENERATED_MANIFEST_FILE,
  loadGeneratedManifest,
  saveGeneratedManifest,
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
