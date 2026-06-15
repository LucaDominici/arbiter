// SPDX-License-Identifier: Apache-2.0
// R7: SSOT completeness — arbiter's own test-pyramid.json must cover every level
// declared by getTestPyramidProfile('library') (arbiter's archetype).
//
// Fail-closed half of the gate-skip strategy: gate SKIPs when manifest absent;
// this TS test ensures the manifest is always present + complete for arbiter self.
// The gate exercises the execution path; this test enforces coverage of the profile.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTestPyramidProfile } from '../../src/config/test-pyramid-profiles.js'

const MANIFEST_PATH = resolve('test-pyramid.json')

interface ManifestLevel {
  id: string
  name: string
  globs?: string[]
  status: 'required' | 'n/a'
  rationale?: string
}

interface Manifest {
  archetype: string
  levels: ManifestLevel[]
}

describe('arbiter self test-pyramid.json SSOT (R7, INV-124)', () => {
  it('test-pyramid.json exists at repo root', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
  })

  it('test-pyramid.json is valid JSON with required schema fields', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf-8')
    const manifest: Manifest = JSON.parse(raw)
    expect(manifest).toHaveProperty('archetype')
    expect(manifest).toHaveProperty('levels')
    expect(Array.isArray(manifest.levels)).toBe(true)
  })

  it('archetype in manifest matches "library" (arbiter\'s archetype)', () => {
    const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    expect(manifest.archetype).toBe('library')
  })

  it('covers every level declared in getTestPyramidProfile("library")', () => {
    const profile = getTestPyramidProfile('library')
    const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))

    // Extract the level IDs from profile level names (e.g. "L1 Unit" → "L1")
    const profileIds = profile.levels.map((l) => {
      const match = /^(L\d+)/.exec(l.name)
      expect(match, `level name "${l.name}" must start with L<digit>`).not.toBeNull()
      return match![1]
    })

    const manifestIds = new Set(manifest.levels.map((l) => l.id))
    for (const id of profileIds) {
      expect(manifestIds.has(id), `manifest is missing level ${id} from profile`).toBe(true)
    }
  })

  it('every required level has at least one glob pattern', () => {
    const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    for (const level of manifest.levels) {
      if (level.status === 'required') {
        expect(
          Array.isArray(level.globs) && level.globs.length > 0,
          `required level ${level.id} must have at least one glob`,
        ).toBe(true)
      }
    }
  })

  it('every n/a level has a rationale ≥20 chars', () => {
    const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    for (const level of manifest.levels) {
      if (level.status === 'n/a') {
        const rationale = typeof level.rationale === 'string' ? level.rationale.trim() : ''
        expect(
          rationale.length,
          `n/a level ${level.id} rationale must be ≥20 chars, got ${rationale.length}`,
        ).toBeGreaterThanOrEqual(20)
      }
    }
  })
})
