// SPDX-License-Identifier: Apache-2.0
// CANON-05 generator unit tests for frontend-quality.ts (#1127)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFrontendQuality } from '../../src/generators/frontend-quality.js'

describe('generateFrontendQuality (#1127)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ── Gate guard ─────────────────────────────────────────────────────────────

  it('returns empty files for non-frontend archetype with no frontend lane', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, { archetype: 'backend-web-db', lanes: ['backend'] }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files for backend-only library archetype', () => {
    const result = generateFrontendQuality(makeConfig(dir, { archetype: 'library' }))
    expect(result.files).toHaveLength(0)
  })

  it('emits files for frontend-spa archetype', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }),
    )
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('emits files when lanes includes frontend (non-spa archetype)', () => {
    const result = generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'backend-web-db',
        lanes: ['frontend', 'backend'],
        governanceLevel: 'L2',
      }),
    )
    expect(result.files.length).toBeGreaterThan(0)
  })

  // ── Token artifacts ────────────────────────────────────────────────────────

  it('emits design-tokens.json (W3C DTCG format)', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'design-tokens.json'))).toBe(true)
    const tokens = JSON.parse(readFileSync(join(dir, 'design-tokens.json'), 'utf-8'))
    // W3C DTCG: top-level key must have nested entries with $value/$type
    const keys = Object.keys(tokens)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('emits scripts/verify-tokens.mjs', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'verify-tokens.mjs'))).toBe(true)
  })

  it('verify-tokens.mjs contains INV-105 reference', () => {
    generateFrontendQuality(makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('INV-105')
  })

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent — second run returns action skipped', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' })
    const result1 = generateFrontendQuality(config)
    expect(result1.files.every((f) => f.action === 'created')).toBe(true)

    const result2 = generateFrontendQuality(config)
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  // ── dryRun ─────────────────────────────────────────────────────────────────

  it('dryRun: true returns created action without writing files', () => {
    const config = makeConfig(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' })
    const result = generateFrontendQuality(config, { dryRun: true })
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
    expect(existsSync(join(dir, 'design-tokens.json'))).toBe(false)
    expect(existsSync(join(dir, 'scripts', 'verify-tokens.mjs'))).toBe(false)
  })

  // ── Framework-aware token output ───────────────────────────────────────────

  it('vue framework: verify-tokens.mjs includes .vue extension', () => {
    generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        frontend: { framework: 'vue' },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('.vue')
  })

  it('react framework: verify-tokens.mjs includes .tsx extension', () => {
    generateFrontendQuality(
      makeConfig(dir, {
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        frontend: { framework: 'react' },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'verify-tokens.mjs'), 'utf-8')
    expect(content).toContain('.tsx')
  })
})
