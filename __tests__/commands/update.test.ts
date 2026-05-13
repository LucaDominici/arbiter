import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { loadConfig } from '../../src/utils/config.js'
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

describe('runUpdate axis-field persistence (M2 regression)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('persists explicit axis fields back to arbiter.json', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        archetype: 'frontend-spa',
        architectureStyle: 'none',
        isMultiTenant: false,
        hasDatabase: false,
        hasPublicApi: false,
      }),
    )

    await runUpdate({ dir, github: false })

    const saved = loadConfig(dir)
    expect(saved?.archetype).toBe('frontend-spa')
    expect(saved?.architectureStyle).toBe('none')
    expect(saved?.isMultiTenant).toBe(false)
    expect(saved?.hasDatabase).toBe(false)
    expect(saved?.hasPublicApi).toBe(false)
  })

  it('detects and persists axis fields when absent from stored config', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    )
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
    )

    await runUpdate({ dir, github: false })

    const saved = loadConfig(dir)
    expect(saved?.archetype).toBe('backend-web-db')
    expect(saved?.architectureStyle).toBe('none')
    expect(saved?.hasDatabase).toBe(true)
    expect(saved?.hasPublicApi).toBe(true)
  })
})

describe('runUpdate — #306 basePackage persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('v2ToProjectConfig preserves basePackage from stored config (#306)', async () => {
    // Write a build.gradle that exposes group (so detectBasePackage picks it up)
    writeFileSync(join(dir, 'build.gradle'), "group = 'com.example'\nplugins { id 'java' }")
    writeV2Config(dir, {
      archetype: 'backend-web-db',
      architectureStyle: 'none',
      isMultiTenant: false,
      hasDatabase: true,
      hasPublicApi: false,
      basePackage: 'com.example',
    })

    await runUpdate({ dir, github: false })

    const saved = loadConfig(dir)
    expect(saved?.basePackage).toBe('com.example')
  })
})

describe('runUpdate — #322 diff uses nextConfig not stored', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('diff is computed against nextConfig (re-detected axis) not stale stored config (#322)', async () => {
    // Scenario: stored config has NO axis fields, snapshot also has no axis fields.
    // express is present → detection yields archetype='backend-web-db'.
    // nextConfig gets archetype='backend-web-db' (from resolveAxisFields falling through to detected).
    // Fix: diff(snapshot={no axis → normalised 'library'}, nextConfig={archetype:'backend-web-db'})
    //      → axis change detected → keysRun.has('*')
    // Without fix: diff(snapshot, stored) → both normalised to 'library' → no diff → keysRun=null
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
        devDependencies: { typescript: '^5.0.0' },
        dependencies: { express: '^4.0.0' },
      }),
    )
    // arbiter.json with NO axis fields
    const baseConfig = {
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
    }
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(baseConfig, null, 2))
    // Snapshot also has no axis fields — simulates a stale snapshot from before axis was recorded
    writeFileSync(join(dir, '.arbiter-generated.json'), JSON.stringify(baseConfig, null, 2))

    const result = await runUpdate({ dir, github: false })

    // detection: express → backend-web-db; snapshot has no archetype (normalised 'library')
    // With fix: diff sees library→backend-web-db on axis field → '*'
    expect(result.keysRun?.has('*')).toBe(true)
  })
})
