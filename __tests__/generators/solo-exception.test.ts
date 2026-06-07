// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests — solo-exception generator (#1250)
 * Validates trunk-solo+L3/L4 generates all three regulated mono-dev pack deliverables.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSoloException } from '../../src/generators/solo-exception.js'
import { makeConfig } from '../helpers.js'

describe('generateSoloException — trunk-solo + L3 (qualifying)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-solo-exc-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates SOLO_DEV_EXCEPTION.md attestation doc', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(existsSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'))).toBe(true)
  })

  it('generates VALIDATION_EVIDENCE_TEMPLATE.md', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(existsSync(join(dir, 'docs', 'governance', 'VALIDATION_EVIDENCE_TEMPLATE.md'))).toBe(
      true,
    )
  })

  it('generates CI_MENTAL_MODEL.md', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(existsSync(join(dir, 'docs', 'governance', 'CI_MENTAL_MODEL.md'))).toBe(true)
  })

  it('generates check-solo-reactivation.mjs script', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(existsSync(join(dir, 'scripts', 'check-solo-reactivation.mjs'))).toBe(true)
  })

  it('attestation doc references §11.10(k)', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    const content = readFileSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'), 'utf-8')
    expect(content).toContain('11.10')
  })

  it('attestation doc references reactivation trigger', () => {
    generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    const content = readFileSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'), 'utf-8')
    expect(content).toMatch(/reactivation|active author/i)
  })

  it('returns WriteResult array with 4 entries', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(result.files).toHaveLength(4)
  })
})

describe('generateSoloException — trunk-solo + L4 (qualifying)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-solo-exc-l4-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('trunk-solo+L4 also generates all deliverables', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L4' }),
    )
    expect(result.files).toHaveLength(4)
    expect(existsSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs', 'governance', 'VALIDATION_EVIDENCE_TEMPLATE.md'))).toBe(
      true,
    )
    expect(existsSync(join(dir, 'docs', 'governance', 'CI_MENTAL_MODEL.md'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-solo-reactivation.mjs'))).toBe(true)
  })
})

describe('generateSoloException — non-qualifying configs (must emit nothing)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-solo-exc-skip-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('trunk-solo+L2 returns empty files (L2 below threshold)', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }),
    )
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'))).toBe(false)
  })

  it('trunk-solo+L1 returns empty files', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L1' }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('peer-review+L3 returns empty files (wrong collaboration mode)', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L3' }),
    )
    expect(result.files).toHaveLength(0)
  })

  it('gated-review+L4 returns empty files', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L4' }),
    )
    expect(result.files).toHaveLength(0)
  })
})

describe('generateSoloException — dryRun mode', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-solo-exc-dry-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('dryRun: returns files without writing to disk', () => {
    const result = generateSoloException(
      makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
      { dryRun: true },
    )
    expect(result.files).toHaveLength(4)
    expect(existsSync(join(dir, 'docs', 'governance', 'SOLO_DEV_EXCEPTION.md'))).toBe(false)
  })
})
