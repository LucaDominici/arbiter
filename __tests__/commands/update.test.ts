import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectConfig } from '../../src/config/resolve-project-config.js'
import { buildRegistry } from '../../src/generators/registry.js'
import type { ArbiterConfigV2 } from '../../src/utils/config.js'

// Pins the canonical config builder now that it lives in resolve-project-config.ts
// (#1077). `resolveProjectConfig` runs the detectors and feeds the result through
// the internal v2ToProjectConfig field-mapping, so asserting on its output covers
// the same field-mapping the former config-v2-to-project.test.ts pinned — now via
// the public entry point both `init`/`update` and `diff` consume.

function makeStored(overrides: Partial<ArbiterConfigV2> = {}): ArbiterConfigV2 {
  return {
    version: 2,
    governanceLevel: 'L2',
    tools: ['claude'],
    decomposition: { backend: 'markdown' },
    features: {
      debtGates: true,
      suppressions: true,
      securityScanning: true,
      mutationTesting: false,
      contractTesting: false,
      evidenceHarness: false,
    },
    thresholds: { coverage: 80, complexity: 10, duplication: 3 },
    invariantTiers: ['architectural', 'governance'],
    ...overrides,
  } as ArbiterConfigV2
}

describe('resolveProjectConfig — canonical builder field mapping (#1077)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-resolve-cfg-'))
    // A typescript marker so detectors resolve a real language/build toolchain.
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'x',
        scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
        devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0', prettier: '^3.0.0' },
      }),
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('maps stored config fields onto the resolved ProjectConfig', () => {
    const { config } = resolveProjectConfig(dir, 'x', makeStored())
    expect(config.governanceLevel).toBe('L2')
    expect(config.tools).toEqual(['claude'])
    expect(config.enableDebtGates).toBe(true)
    expect(config.enableSecurityScanning).toBe(true)
    expect(config.enableMutationTesting).toBe(false)
    expect(config.language).toBe('typescript')
    expect(config.projectName).toBe('x')
    expect(config.targetDir).toBe(dir)
    expect(config.thresholds).toEqual({ coverage: 80, complexity: 10, duplication: 3 })
  })

  it('feeds detector-derived fields (language, build commands, existing) into the config', () => {
    const { config, detectorFields } = resolveProjectConfig(dir, 'x', makeStored())
    // detectorFields are mirrored onto the config (spread in v2ToProjectConfig).
    expect(config.language).toBe(detectorFields.language)
    expect(config.buildCommand).toBe(detectorFields.buildCommand)
    expect(config.existing).toBe(detectorFields.existing)
    expect(config.languageHooks).toBe(detectorFields.languageHooks)
  })

  it('defaults useGitHub backend to false (diff never touches GitHub)', () => {
    const { config } = resolveProjectConfig(dir, 'x', makeStored())
    expect(config.useGitHub).toBe(false)
  })

  it('reflects useGitHubBackend when explicitly enabled (init/update --github path)', () => {
    const { config } = resolveProjectConfig(dir, 'x', makeStored(), true)
    expect(config.useGitHub).toBe(true)
  })

  // #1343 R7: a Go-primary polyglot repo (go.mod + a frontend-lane package.json) with
  // stored `language: go` must resolve `go`, not the package.json-shadowed `typescript`.
  it('honors stored language go over package.json-shadowed detection (#1343)', () => {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n\ngo 1.22\n')
    const { config } = resolveProjectConfig(dir, 'x', makeStored({ language: 'go' }))
    expect(config.language).toBe('go')
  })

  // #1568: the writer (buildArbiterConfig) persists observability/auth/frontend, but the
  // round-trip reader (storedOptionalFields) previously spread only `frontend`, so a stored
  // non-none observability/auth was dropped to undefined — disabling both provider generators
  // on every `arbiter update`/`diff`. Pin that a stored config carrying both survives the
  // round-trip AND that buildRegistry enables the observability/auth specs for it.
  it('round-trips stored observability and auth provider config (#1568)', () => {
    const stored = makeStored({
      observability: { provider: 'signoz', metrics: true, logs: true },
      auth: { provider: 'app-level-ts', protocols: ['oidc'] },
    })
    const { config } = resolveProjectConfig(dir, 'x', stored)
    expect(config.observability).toEqual({ provider: 'signoz', metrics: true, logs: true })
    expect(config.auth).toEqual({ provider: 'app-level-ts', protocols: ['oidc'] })

    const registry = buildRegistry(config)
    const obs = registry.find((s) => s.key === 'observability')
    const auth = registry.find((s) => s.key === 'auth')
    expect(obs?.enabled).toBe(true)
    expect(auth?.enabled).toBe(true)
  })

  // #1616: deployTarget + taxonomy were persisted by the writer but never read back
  // by storedOptionalFields — so the round-trip coerced deployTarget→'none' and
  // taxonomy→undefined, silently disabling deploy-workflow propagation and custom
  // test-taxonomy dims on every backend-web-db `arbiter update`/`diff`.
  it('round-trips stored deployTarget and taxonomy config (#1616)', () => {
    const stored = makeStored({
      deployTarget: 'azure-container-app',
      taxonomy: { domainDims: ['billing', 'fraud'] },
    } as Partial<ArbiterConfigV2>)
    const { config } = resolveProjectConfig(dir, 'x', stored)
    expect(config.deployTarget).toBe('azure-container-app')
    expect(config.taxonomy).toEqual({ domainDims: ['billing', 'fraud'] })
  })
})
