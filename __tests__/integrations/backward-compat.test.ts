// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../../src/utils/config.js'

const MANIFEST_PATH = resolve('__tests__/fixtures/compat/MANIFEST.json')
const COMPAT_DIR = resolve('__tests__/fixtures/compat')

interface ManifestEntry {
  version: string
  archetype: string
  language: string
  path: string
}

describe('backward-compat harness (#608)', () => {
  it('MANIFEST.json exists and is valid JSON', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
    const content = readFileSync(MANIFEST_PATH, 'utf-8')
    const parsed: unknown = JSON.parse(content)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('each manifest entry has required fields', () => {
    const entries: ManifestEntry[] = JSON.parse(
      readFileSync(MANIFEST_PATH, 'utf-8'),
    ) as ManifestEntry[]
    for (const entry of entries) {
      expect(typeof entry.version).toBe('string')
      expect(typeof entry.archetype).toBe('string')
      expect(typeof entry.language).toBe('string')
      expect(typeof entry.path).toBe('string')
    }
  })

  it('each manifest entry has a corresponding fixture directory', () => {
    const entries: ManifestEntry[] = JSON.parse(
      readFileSync(MANIFEST_PATH, 'utf-8'),
    ) as ManifestEntry[]
    for (const entry of entries) {
      const fixturePath = join(COMPAT_DIR, entry.path)
      expect(existsSync(fixturePath), `fixture missing: ${entry.path}`).toBe(true)
    }
  })

  it('each fixture arbiter.json loads without schema errors (backward compat)', () => {
    const entries: ManifestEntry[] = JSON.parse(
      readFileSync(MANIFEST_PATH, 'utf-8'),
    ) as ManifestEntry[]
    if (entries.length === 0) return // vacuously passes on empty manifest

    for (const entry of entries) {
      const fixturePath = join(COMPAT_DIR, entry.path)
      let config: ReturnType<typeof loadConfig> | undefined
      // loadConfig returns null if file missing, throws on schema error.
      expect(() => {
        config = loadConfig(fixturePath)
      }, `fixture ${entry.path} loadConfig threw — schema not backward-compatible`).not.toThrow()
      expect(config, `fixture ${entry.path}: arbiter.json missing or returned null`).not.toBeNull()
    }
  })
})
