// SPDX-License-Identifier: Apache-2.0
// TDD RED: #1048 — helpers.ts empty catch{} blocks silently drop broken fixtures.
// Strategy: create temp entries in the real FIXTURES_ROOT during each test, then clean up.
// After fix: corrupt manifest.json throws; ENOENT is the only race-tolerant skip.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listFixtures } from '../../../__tests__/integration/e2e/helpers.js'

const FIXTURES_ROOT = resolve('__tests__/fixtures/real-projects')

const MANIFEST_OK = JSON.stringify({
  language: 'ts',
  archetype: 'library',
  levels: ['standard'],
  tier: 'bake',
})

// Names chosen to sort last so they don't interfere with the real fixture list.
const TEMP_BAD = 'zzz-test-bad-manifest'
const TEMP_GOOD = 'zzz-test-good-manifest'
const TEMP_NO_MANIFEST = 'zzz-test-no-manifest'

describe('#1048 — listFixtures fail-loud', () => {
  afterEach(() => {
    for (const name of [TEMP_BAD, TEMP_GOOD, TEMP_NO_MANIFEST]) {
      rmSync(join(FIXTURES_ROOT, name), { recursive: true, force: true })
    }
  })

  it('throws when a fixture has corrupt manifest.json', () => {
    mkdirSync(join(FIXTURES_ROOT, TEMP_BAD), { recursive: true })
    writeFileSync(join(FIXTURES_ROOT, TEMP_BAD, 'manifest.json'), '{ broken json')

    expect(() => listFixtures('bake')).toThrow(/zzz-test-bad-manifest|manifest\.json/)
  })

  it('includes valid fixture (regression guard)', () => {
    mkdirSync(join(FIXTURES_ROOT, TEMP_GOOD), { recursive: true })
    writeFileSync(join(FIXTURES_ROOT, TEMP_GOOD, 'manifest.json'), MANIFEST_OK)

    const result = listFixtures('bake')
    expect(result).toContain(TEMP_GOOD)
  })

  it('skips a directory with no manifest.json silently', () => {
    mkdirSync(join(FIXTURES_ROOT, TEMP_NO_MANIFEST), { recursive: true })

    const result = listFixtures('bake')
    expect(result).not.toContain(TEMP_NO_MANIFEST)
  })
})
