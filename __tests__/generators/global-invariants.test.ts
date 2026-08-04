import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGlobalInvariants } from '../../src/generators/global-invariants.js'
import { makeConfig } from '../helpers.js'
import { presetToTiers } from '../../src/invariants/filter.js'

describe('generateGlobalInvariants', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-global-inv-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns skipped for essential preset (architectural + governance only)', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L1',
      invariantTiers: presetToTiers('essential'),
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('skipped')
    // M1/#1491: the skip is a DELIBERATE non-emission (no optional tiers), tagged
    // `not-applicable` so init reporting does not falsely claim "already exists"
    // and the post-write presence check does not flag it as a lost file.
    expect(result.reason).toBe('not-applicable')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md'))).toBe(false)
  })

  it('creates GLOBAL_INVARIANTS.md for standard preset', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('created')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md'))).toBe(true)
  })

  it('creates GLOBAL_INVARIANTS.md for full preset', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L3',
      invariantTiers: presetToTiers('full'),
    })
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('created')
  })

  it('renders declared PROJ-NN project invariants into the doc (TC-1)', () => {
    const projInvariant = {
      id: 'PROJ-01',
      tier: 'governance',
      title: 'Tenancy isolation is a product contract',
      description: 'Every tenant-scoped resource must carry owner_id (viafera product contract).',
      alwaysActive: true,
      enforcement: 'CI (constraint scan); code review',
    }
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
      projectInvariants: [projInvariant],
    } as Partial<Parameters<typeof makeConfig>[1]> & { projectInvariants: typeof projInvariant[] })
    generateGlobalInvariants(config)
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(content).toContain('PROJ-01')
    expect(content).toContain('Tenancy isolation is a product contract')
  })

  it('content includes all 5 tier headings for full preset', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L3',
      invariantTiers: presetToTiers('full'),
    })
    generateGlobalInvariants(config)
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(content).toContain('Tier 1: Architectural Integrity')
    expect(content).toContain('Tier 2: Data Integrity')
    expect(content).toContain('Tier 3: Security & Compliance')
    expect(content).toContain('Tier 4: Operational Excellence')
    expect(content).toContain('Tier 5: Governance')
  })

  it('standard preset at L2 includes security tier (INV-11/12/13 alwaysActive, M24)', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    generateGlobalInvariants(config)
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(content).toContain('Tier 1: Architectural Integrity')
    expect(content).toContain('Tier 2: Data Integrity')
    // INV-11/12/13 are alwaysActive=true at L2+, so security tier appears even with standard preset
    expect(content).toContain('Tier 3: Security')
    expect(content).toContain('Tier 4: Operational Excellence')
    expect(content).toContain('Tier 5: Governance')
    // #1635: INV-14/15 are alwaysActive=true security invariants, present at L2 standard
    expect(content).toContain('INV-14')
    expect(content).toContain('INV-15')
  })

  it('content includes invariant descriptions', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    generateGlobalInvariants(config)
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    // INV-01 description
    expect(content).toContain('circular')
    // INV-21 (TODO refs) description
    expect(content).toContain('INV-21')
  })

  it('language-specific details shown for correct language', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    generateGlobalInvariants(config)
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(content).toContain('.unwrap()')
  })

  it('backs up existing file when regenerated content differs', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    generateGlobalInvariants(config)
    // Simulate a user edit so the regenerated content genuinely differs from disk;
    // only then does writeFile take the backup-and-replace path. (#1077: a
    // byte-identical regeneration now skips and does NOT churn a backup.)
    writeFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), '# user-edited\n', 'utf-8')
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('backed-up-and-replaced')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'))).toBe(true)
    expect(readFileSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'), 'utf-8')).toBe(
      '# user-edited\n',
    )
  })

  it('skips a byte-identical regeneration without backing up (#1077 F6 idempotence)', () => {
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    generateGlobalInvariants(config)
    // Second run, no on-disk change → byte-identical → skipped, no churned backup.
    const result = generateGlobalInvariants(config)
    expect(result.action).toBe('skipped')
    expect(existsSync(join(dir, 'GLOBAL_INVARIANTS.md.arbiter-backup'))).toBe(false)
  })

  it('regeneration with projectInvariants is idempotent — zero diff (TC-6)', () => {
    const projInvariant = {
      id: 'PROJ-01',
      tier: 'governance',
      title: 'Tenancy isolation is a product contract',
      description: 'Every tenant-scoped resource must carry owner_id.',
      alwaysActive: true,
      enforcement: 'CI (constraint scan); code review',
    }
    const config = makeConfig(dir, {
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
      projectInvariants: [projInvariant],
    } as Partial<Parameters<typeof makeConfig>[1]> & { projectInvariants: typeof projInvariant[] })
    const first = generateGlobalInvariants(config)
    expect(first.action).toBe('created')
    const firstContent = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    const second = generateGlobalInvariants(config)
    expect(second.action).toBe('skipped')
    expect(readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')).toBe(firstContent)
  })
})
