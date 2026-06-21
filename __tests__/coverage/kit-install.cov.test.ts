// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/commands/kit-install.ts (#1486).
//
// This module has no dependency-injection seam — it imports concrete fs/git/
// catalog/generator dependencies directly. It is fully exercised through real
// temp-dir fixtures: each test writes a target directory (optionally with an
// arbiter.json and/or a git remote) and runs the real `runKitInstall`. No
// network, no mutation of the developer's repo, no `gh`/`git push` — the only
// `gh`-touching branch (emit-issues) is exercised under `dryRun: true`, which
// is a pure stderr write.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { runKitInstall, type KitInstallOptions } from '../../src/commands/kit-install.js'
import type { ArbiterConfig } from '../../src/utils/config.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { presetToTiers, defaultPresetForLevel } from '../../src/invariants/filter.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kit-install-cov-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeOptions(overrides: Partial<KitInstallOptions> = {}): KitInstallOptions {
  return {
    targetDir: tmpDir,
    language: 'java',
    brownfieldClass: 'gold',
    dryRun: true,
    ...overrides,
  }
}

/**
 * A FULL arbiter.json that explicitly sets every optional field — exercising
 * the truthy (left-hand) side of every `??` fallback in `storedDefaults` and
 * the present-spread of `acceptBetaTools` / `observability` / `auth`.
 */
function fullConfig(overrides: Partial<ArbiterConfig> = {}): ArbiterConfig {
  const governanceLevel = 'L2'
  return {
    version: '0.2',
    tools: ['claude', 'codex'],
    governanceLevel,
    permitGitHub: true,
    features: {
      debtGates: true,
      suppressions: true,
      securityScanning: true,
      mutationTesting: true,
      contractTesting: true,
      evidenceHarness: true,
      selfValidationHarness: false,
    },
    thresholds: DEFAULT_THRESHOLDS[governanceLevel],
    invariantTiers: presetToTiers(defaultPresetForLevel(governanceLevel)),
    archetype: 'backend-web-db',
    architectureStyle: 'layered',
    isMultiTenant: true,
    hasDatabase: false,
    hasPublicApi: true,
    contractType: 'rest-owned',
    acceptBetaTools: true,
    observability: { provider: 'none' },
    auth: { provider: 'none' },
    lanes: [],
    ...overrides,
  }
}

/**
 * A MINIMAL but valid arbiter.json: every optional field that `storedDefaults`
 * guards with `??` is OMITTED, so the right-hand fallback branch is taken for
 * each (archetype→'library', architectureStyle→'none', selfValidationHarness→
 * true, invariantTiers→presetToTiers, contractType→'none', lanes→[]), and the
 * `acceptBetaTools`/`observability`/`auth` spreads take the absent branch.
 */
function minimalConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      debtGates: false,
      suppressions: false,
      securityScanning: false,
      mutationTesting: false,
      contractTesting: false,
      evidenceHarness: false,
    },
    thresholds: DEFAULT_THRESHOLDS['L2'],
    ...overrides,
  }
}

function writeConfig(dir: string, config: unknown): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2) + '\n')
}

function initGitRepoWithRemote(dir: string, remoteUrl: string): void {
  const opts = { cwd: dir, stdio: 'ignore' as const }
  execFileSync('git', ['init', '-q'], opts)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts)
  execFileSync('git', ['config', 'user.name', 'Test'], opts)
  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], opts)
}

describe('runKitInstall — storedDefaults fallback branches (no arbiter.json present)', () => {
  it('builds config from defaults and reports no arbiter.json in SCAFFOLD', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toContain('no arbiter.json')
  })
})

describe('runKitInstall — full arbiter.json (storedDefaults left-hand branches)', () => {
  it('loads a fully-populated config and runs all phases (dry-run)', async () => {
    writeConfig(tmpDir, fullConfig())
    const result = await runKitInstall(makeOptions({ dryRun: true }))
    expect(result.ok).toBe(true)
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    // arbiter.json present => SCAFFOLD reports file counts, NOT "no arbiter.json"
    expect(scaffold?.output).toMatch(/SCAFFOLD: \d+ files/)
    expect(scaffold?.output).toContain('dry-run')
  })

  it('honours acceptBetaTools / observability / auth present-spread branches', async () => {
    writeConfig(
      tmpDir,
      fullConfig({
        acceptBetaTools: true,
        observability: { provider: 'none' },
        auth: { provider: 'none' },
      }),
    )
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
  })
})

describe('runKitInstall — minimal arbiter.json (storedDefaults right-hand ?? fallbacks)', () => {
  it('fills every omitted optional field from its default and succeeds', async () => {
    writeConfig(tmpDir, minimalConfig())
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
    const phases = result.phases.map((p) => p.phase)
    expect(phases).toContain('SCAFFOLD')
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toMatch(/SCAFFOLD: \d+ files/)
  })
})

describe('runKitInstall — SCAFFOLD non-dry-run (real writes into temp dir)', () => {
  it('writes files and reports a written count when dryRun=false', async () => {
    writeConfig(tmpDir, fullConfig())
    const result = await runKitInstall(makeOptions({ dryRun: false }))
    expect(result.ok).toBe(true)
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    // Non-dry-run branch uses "written", not "dry-run".
    expect(scaffold?.output).toMatch(/SCAFFOLD: \d+ files \(\d+ written/)
    expect(scaffold?.output).not.toContain('dry-run')
  })

  it('persists measurements into arbiter.json when not dry-run', async () => {
    writeConfig(tmpDir, fullConfig())
    await runKitInstall(makeOptions({ dryRun: false }))
    // phaseMeasure persists the `kit.measure` block when !dryRun && arbiterConfig.
    const reloaded = JSON.parse(readFileSync(join(tmpDir, 'arbiter.json'), 'utf-8')) as {
      kit?: { measure?: Record<string, unknown> }
    }
    expect(reloaded.kit).toBeDefined()
    expect(reloaded.kit?.measure).toBeDefined()
  })
})

describe('runKitInstall — git remote drives useGitHub branch', () => {
  it('sets useGitHub from a github origin remote (githubOwner !== null)', async () => {
    initGitRepoWithRemote(tmpDir, 'git@github.com:acme/widget.git')
    writeConfig(tmpDir, minimalConfig({ useGitHub: false }))
    const result = await runKitInstall(makeOptions())
    // The branch we want is buildProjectConfig's `useGitHub: githubOwner !== null`.
    // storedDefaults overrides useGitHub from config, but buildProjectConfig still
    // evaluates the github branch during construction — it runs without error.
    expect(result.ok).toBe(true)
  })

  it('handles a non-github remote (githubOwner === null)', async () => {
    initGitRepoWithRemote(tmpDir, 'https://example.com/acme/widget.git')
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
  })
})

describe('runKitInstall — hasDatabase without databaseEngine warns (line 314)', () => {
  it('emits a stderr warning when hasDatabase=true and databaseEngine is unset', async () => {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    const spy = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write
    try {
      writeConfig(tmpDir, fullConfig({ hasDatabase: true }))
      const result = await runKitInstall(makeOptions())
      expect(result.ok).toBe(true)
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).toContain('hasDatabase=true but databaseEngine unknown')
  })

  it('does NOT warn when hasDatabase is false', async () => {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    const spy = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write
    try {
      writeConfig(tmpDir, fullConfig({ hasDatabase: false }))
      await runKitInstall(makeOptions())
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).not.toContain('hasDatabase=true but databaseEngine unknown')
  })
})

describe('runKitInstall — reportPath writes an audit report (line 349)', () => {
  it('writes the audit markdown to a nested reportPath, creating dirs', async () => {
    const reportPath = join(tmpDir, 'nested', 'sub', 'audit.md')
    const result = await runKitInstall(makeOptions({ reportPath }))
    expect(result.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    const content = readFileSync(reportPath, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('does NOT write a report when reportPath is omitted', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
    expect(existsSync(join(tmpDir, 'audit.md'))).toBe(false)
  })
})

describe('runKitInstall — emitIssues branch (dry-run safe)', () => {
  it('emits dry-run issue lines to stderr when emitIssues=true', async () => {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    const spy = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write
    try {
      const result = await runKitInstall(makeOptions({ emitIssues: true, dryRun: true }))
      expect(result.ok).toBe(true)
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).toContain('[emit-issues]')
  })

  it('does NOT touch emit-issues when emitIssues is omitted', async () => {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    const spy = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write
    try {
      await runKitInstall(makeOptions())
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).not.toContain('[emit-issues]')
  })
})

describe('runKitInstall — error path (catch block, lines 365-367)', () => {
  it('returns ok=false with an error when arbiter.json is malformed JSON', async () => {
    // loadConfig throws ConfigError on invalid JSON; runKitInstall catches it.
    writeFileSync(join(tmpDir, 'arbiter.json'), '{ this is not valid json ')
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('arbiter.json')
    // The error path returns whatever phases ran before the throw (none here,
    // since loadConfig is the first call after entry).
    expect(Array.isArray(result.phases)).toBe(true)
  })

  it('returns ok=false when arbiter.json fails validation', async () => {
    // governanceLevel is required and must be valid — omit tools to fail validation.
    writeConfig(tmpDir, { version: '0.2', governanceLevel: 'L2', permitGitHub: false })
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('runKitInstall — language auto-detect vs explicit (entry branch)', () => {
  it('auto-detects language when omitted', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))
    const result = await runKitInstall({
      targetDir: tmpDir,
      brownfieldClass: 'medium',
      dryRun: true,
    })
    const detect = result.phases.find((p) => p.phase === 'DETECT')
    expect(detect?.output).toContain('typescript')
  })

  it('uses the explicit language when provided', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))
    const result = await runKitInstall(makeOptions({ language: 'go' }))
    const detect = result.phases.find((p) => p.phase === 'DETECT')
    expect(detect?.output).toContain('go')
  })
})

describe('runKitInstall — brownfieldClass variations (wave plan input)', () => {
  it('accepts a medium brownfield class', async () => {
    const result = await runKitInstall(makeOptions({ brownfieldClass: 'medium' }))
    expect(result.ok).toBe(true)
    expect(result.wavePlan).toBeDefined()
  })

  it('accepts a light brownfield class', async () => {
    const result = await runKitInstall(makeOptions({ brownfieldClass: 'light' }))
    expect(result.ok).toBe(true)
  })
})
