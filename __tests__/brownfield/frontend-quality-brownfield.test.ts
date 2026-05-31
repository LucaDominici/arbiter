// SPDX-License-Identifier: Apache-2.0
// CANON-11 brownfield test for frontend-quality.ts (#1127)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFrontendQuality } from '../../src/generators/frontend-quality.js'

describe('generateFrontendQuality brownfield (CANON-11, #1127)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing design-tokens.json on re-run', () => {
    const target = join(dir, 'design-tokens.json')
    const sentinel = '{"$schema":"user-modified-tokens"}\n'
    writeFileSync(target, sentinel)

    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing scripts/verify-tokens.mjs on re-run', () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    const target = join(scriptsDir, 'verify-tokens.mjs')
    const sentinel = '#!/usr/bin/env node\n// user-modified token gate\n'
    writeFileSync(target, sentinel)

    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing scripts/verify-i18n-parity.mjs on re-run', () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    const target = join(scriptsDir, 'verify-i18n-parity.mjs')
    const sentinel = '#!/usr/bin/env node\n// user-modified i18n gate\n'
    writeFileSync(target, sentinel)

    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing .lighthouserc.json on re-run', () => {
    const target = join(dir, '.lighthouserc.json')
    const sentinel =
      '{"ci":{"collect":{"url":["http://custom-url"]},"assert":{"preset":"no-pwa"}}}\n'
    writeFileSync(target, sentinel)

    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing vitest.browser.config.ts on re-run', () => {
    const target = join(dir, 'vitest.browser.config.ts')
    const sentinel = '// user-modified vitest browser config\nexport default {}\n'
    writeFileSync(target, sentinel)

    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('returns all-skipped on second run (fully idempotent)', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa' })
    const r1 = generateFrontendQuality(config)
    expect(r1.files.every((f) => f.action === 'created')).toBe(true)

    const r2 = generateFrontendQuality(config)
    expect(r2.files.every((f) => f.action === 'skipped')).toBe(true)
  })
})
