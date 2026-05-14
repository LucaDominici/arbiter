import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runConfigure } from '../../src/commands/configure.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

function writeV2Config(dir: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    ...overrides,
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2))
}

function readArbiterJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<string, unknown>
}

describe('runConfigure — --set round-trips', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('sets features.debtGates=false and writes valid v2 to disk', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['features.debtGates=false'] })

    const raw = readArbiterJson(dir)
    const features = raw['features'] as Record<string, unknown>
    expect(features['debtGates']).toBe(false)
    expect(features['suppressions']).toBe(true) // unchanged
    expect(raw['version']).toBe('0.2')
  })

  it('sets thresholds.lineCoverage=90 and persists', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['thresholds.lineCoverage=90'] })

    const raw = readArbiterJson(dir)
    const thresholds = raw['thresholds'] as Record<string, unknown>
    expect(thresholds['lineCoverage']).toBe(90)
    expect(thresholds['branchCoverage']).toBe(DEFAULT_THRESHOLDS.L2.branchCoverage) // unchanged
  })

  it('applies multiple --set flags atomically', () => {
    writeV2Config(dir)

    runConfigure({
      dir,
      sets: ['features.mutationTesting=false', 'thresholds.lineCoverage=85'],
    })

    const raw = readArbiterJson(dir)
    expect((raw['features'] as Record<string, unknown>)['mutationTesting']).toBe(false)
    expect((raw['thresholds'] as Record<string, unknown>)['lineCoverage']).toBe(85)
  })
})

describe('runConfigure — validation', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('rejects an unknown dotted path and does not write', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['nonExistent.key=true'] })).toThrow()

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('rejects out-of-range lineCoverage (>100) and does not write', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['thresholds.lineCoverage=150'] })).toThrow()

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('rejects invalid boolean value for a feature flag and does not write', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['features.debtGates=maybe'] })).toThrow()

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('exits with code 2 when no --set provided and no TTY', () => {
    writeV2Config(dir)
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null) => {
        throw new Error(`process.exit(${String(_code)})`)
      })

    expect(() => runConfigure({ dir, sets: [] })).toThrow('process.exit(2)')

    exitSpy.mockRestore()
  })

  it('throws when no arbiter.json found', () => {
    expect(() => runConfigure({ dir, sets: ['features.debtGates=false'] })).toThrow()
  })

  it('rejects an invalid tool name and does not write', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['tools=claude,unknown-tool'] })).toThrow()

    expect(readArbiterJson(dir)).toEqual(before)
  })
})

describe('runConfigure — tools', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('sets tools to a comma-separated list of valid AI tools', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['tools=codex,cursor'] })

    const raw = readArbiterJson(dir)
    expect(raw['tools']).toEqual(['codex', 'cursor'])
  })

  it('sets tools to a single tool', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['tools=copilot'] })

    const raw = readArbiterJson(dir)
    expect(raw['tools']).toEqual(['copilot'])
  })
})

describe('runConfigure — axis fields (#324)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('sets archetype=library and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['archetype=library'] })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('library')
  })

  it('rejects invalid archetype (#324)', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['archetype=invalid-archetype'] })).toThrow(
      /invalid archetype/i,
    )

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('sets archetype=backend-web-db and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['archetype=backend-web-db'] })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('backend-web-db')
  })

  it('sets architectureStyle=hexagonal and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['architectureStyle=hexagonal'] })

    const raw = readArbiterJson(dir)
    expect(raw['architectureStyle']).toBe('hexagonal')
  })

  it('rejects invalid architectureStyle (#324)', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['architectureStyle=event-driven'] })).toThrow(
      /invalid architecturestyle/i,
    )

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('sets hasDatabase=true and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['hasDatabase=true'] })

    const raw = readArbiterJson(dir)
    expect(raw['hasDatabase']).toBe(true)
  })

  it('sets hasDatabase=false and persists (#324)', () => {
    writeV2Config(dir, { hasDatabase: true })

    runConfigure({ dir, sets: ['hasDatabase=false'] })

    const raw = readArbiterJson(dir)
    expect(raw['hasDatabase']).toBe(false)
  })

  it('rejects invalid boolean for hasDatabase (#324)', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['hasDatabase=yes'] })).toThrow(
      /hasDatabase must be true or false/i,
    )

    expect(readArbiterJson(dir)).toEqual(before)
  })

  it('sets isMultiTenant=true and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['isMultiTenant=true'] })

    const raw = readArbiterJson(dir)
    expect(raw['isMultiTenant']).toBe(true)
  })

  it('sets hasPublicApi=true and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['hasPublicApi=true'] })

    const raw = readArbiterJson(dir)
    expect(raw['hasPublicApi']).toBe(true)
  })

  it('sets contractType=graphql and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['contractType=graphql'] })

    const raw = readArbiterJson(dir)
    expect(raw['contractType']).toBe('graphql')
  })

  it('sets contractType=rest-owned and persists (#324)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['contractType=rest-owned'] })

    const raw = readArbiterJson(dir)
    expect(raw['contractType']).toBe('rest-owned')
  })

  it('rejects invalid contractType (#324)', () => {
    writeV2Config(dir)
    const before = readArbiterJson(dir)

    expect(() => runConfigure({ dir, sets: ['contractType=openapi'] })).toThrow(
      /invalid contracttype/i,
    )

    expect(readArbiterJson(dir)).toEqual(before)
  })
})

describe('runConfigure — archetype cascade (#504)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('cascades derived axis fields when archetype=library is set (#504)', () => {
    writeV2Config(dir) // no archetype / no derived fields stored

    runConfigure({ dir, sets: ['archetype=library'] })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('library')
    // library archetype derivations per src/detectors/axis.ts
    expect(raw['hasDatabase']).toBe(false)
    expect(raw['hasPublicApi']).toBe(false)
    expect(raw['contractType']).toBe('none')
  })

  it('cascades derived axis fields when archetype=backend-web-db is set (#504)', () => {
    writeV2Config(dir)

    runConfigure({ dir, sets: ['archetype=backend-web-db'] })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('backend-web-db')
    // backend-web-db archetype derivations
    expect(raw['hasDatabase']).toBe(true)
    expect(raw['hasPublicApi']).toBe(true)
    expect(raw['contractType']).toBe('rest-owned')
  })

  it('cascade respects explicit --set in same batch (#504)', () => {
    writeV2Config(dir)

    runConfigure({
      dir,
      sets: ['archetype=library', 'hasDatabase=true'],
    })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('library')
    // user override wins: hasDatabase=true is preserved despite library default false
    expect(raw['hasDatabase']).toBe(true)
    // un-overridden derived fields still cascaded
    expect(raw['hasPublicApi']).toBe(false)
    expect(raw['contractType']).toBe('none')
  })

  it('cascade preserves previously-stored explicit axis fields (#504)', () => {
    writeV2Config(dir, { hasDatabase: true, hasPublicApi: true })

    runConfigure({ dir, sets: ['archetype=library'] })

    const raw = readArbiterJson(dir)
    expect(raw['archetype']).toBe('library')
    // previously-stored explicit values preserved
    expect(raw['hasDatabase']).toBe(true)
    expect(raw['hasPublicApi']).toBe(true)
    // contractType was not stored and was derived from new archetype+hasPublicApi
    // library + hasPublicApi=true → defaultContractType returns 'none'
    expect(raw['contractType']).toBe('none')
  })

  it('cascade does not run when archetype is not in --set batch (#504)', () => {
    writeV2Config(dir, { archetype: 'library' })

    runConfigure({ dir, sets: ['features.debtGates=false'] })

    const raw = readArbiterJson(dir)
    // archetype unchanged, no derived fields injected
    expect(raw['archetype']).toBe('library')
    expect(raw['hasDatabase']).toBeUndefined()
    expect(raw['hasPublicApi']).toBeUndefined()
    expect(raw['contractType']).toBeUndefined()
  })
})
