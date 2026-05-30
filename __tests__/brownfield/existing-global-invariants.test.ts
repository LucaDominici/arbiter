import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGlobalInvariants } from '../../src/generators/global-invariants.js'

describe('brownfield: existing GLOBAL_INVARIANTS.md', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('backs up existing GLOBAL_INVARIANTS.md before replacing (L2 config)', () => {
    const original = '# ORIGINAL\nHand-written invariants.'
    writeFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), original)

    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateGlobalInvariants(config)

    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'))).toBe(true)
    const backup = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'), 'utf-8')
    expect(backup).toBe(original)
  })

  it('replaces GLOBAL_INVARIANTS.md with arbiter-generated content', () => {
    const original = '# ORIGINAL\nHand-written invariants.'
    writeFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), original)

    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateGlobalInvariants(config)

    const newContent = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(newContent).not.toContain('Hand-written invariants.')
    expect(newContent.length).toBeGreaterThan(0)
  })

  it('returns backed-up-and-replaced action when file pre-exists', () => {
    writeFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), '# old')

    const config = makeConfig(dir, { governanceLevel: 'L2' })
    const result = generateGlobalInvariants(config)

    expect(result.action).toBe('backed-up-and-replaced')
  })

  it('returns created action when no pre-existing file (L2)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    const result = generateGlobalInvariants(config)

    expect(result.action).toBe('created')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md'))).toBe(true)
  })

  it('second identical run skips and writes no backup (#1077 F6 idempotence)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    // First run creates the file (no pre-existing file → no backup yet).
    const first = generateGlobalInvariants(config)
    expect(first.action).toBe('created')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'))).toBe(false)

    // Second run with no on-disk change → byte-identical → skipped, still no backup.
    const second = generateGlobalInvariants(config)
    expect(second.action).toBe('skipped')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'))).toBe(false)
  })

  it('a differing second run backs up the first-generated content before replacing (#1077)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateGlobalInvariants(config)
    const firstGenerated = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')

    // Simulate a manual edit so the regenerated content genuinely differs from disk.
    writeFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), '# manually edited\n')

    generateGlobalInvariants(config)

    const backup = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'), 'utf-8')
    expect(backup).toBe('# manually edited\n')
    expect(readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')).toBe(firstGenerated)
  })

  it('returns skipped action for L1 config (no optional tiers)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    const result = generateGlobalInvariants(config)

    expect(result.action).toBe('skipped')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md'))).toBe(false)
  })

  it('returns skipped for config with only architectural + governance tiers', () => {
    const config = makeConfig(dir, {
      invariantTiers: ['architectural', 'governance'],
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('skipped')
  })

  it('generates when config has data tier', () => {
    const config = makeConfig(dir, {
      invariantTiers: ['architectural', 'governance', 'data'],
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('created')
  })

  it('generates when config has security tier', () => {
    const config = makeConfig(dir, {
      invariantTiers: ['architectural', 'governance', 'security'],
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('created')
  })
})
