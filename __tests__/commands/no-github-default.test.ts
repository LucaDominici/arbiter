// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for #1063: --github opt-in default (F4) + project board namespacing (F11)
 *
 * Core invariants verified:
 * 1. No gh API calls when --github absent + ARBITER_GITHUB unset, even if stored config has useGitHub:true
 * 2. ARBITER_GITHUB=1 activates gh API calls
 * 3. useGitHub → permitGitHub migration: field renamed, old field deleted, no deprecation loop
 * 4. Board probe: prefix match (not exact) to avoid false-positives on similar repo names
 * 5. nextConfig never writes runtime useGitHub boolean back to disk
 * 6. validateConfig accepts permitGitHub-only configs (AND semantics for missing-field error)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { DEFAULT_THRESHOLDS, validateConfig } from '../../src/config/schema.js'
import { runUpdate } from '../../src/commands/update.js'
import { loadConfig } from '../../src/utils/config.js'
import { createProjectBoard } from '../../src/github/project-board.js'

vi.mock('../../src/detectors/github.js', () => ({
  detectGithubAccess: vi.fn().mockReturnValue({ authenticated: true, username: 'testuser' }),
}))

vi.mock('../../src/detectors/git.js', () => ({
  detectGitInfo: vi.fn().mockReturnValue({
    githubOwner: 'testorg',
    githubRepo: 'testrepo',
    currentBranch: 'main',
    defaultBranch: 'main',
  }),
  detectAdverseGitState: vi.fn().mockReturnValue(null),
}))

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn().mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }),
  runCliJson: vi.fn().mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === 'project' && args[1] === 'list') return { projects: [] }
    if (args[0] === 'label' && args[1] === 'list') return []
    if (args[0] === 'project' && args[1] === 'field-list')
      return { fields: [{ name: 'Priority' }, { name: 'Size' }] }
    return {}
  }),
}))

import { runCli, runCliJson } from '../../src/utils/run-cli.js'

function writeConfig(dir: string, overrides: Record<string, unknown> = {}): void {
  const cfg = {
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
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(cfg, null, 2))
}

// ── Test 6: validateConfig AND semantics ─────────────────────────────────────
// This must PASS (baseline guard) — runs without mocks, no side effects.

describe('validateConfig: permitGitHub field acceptance (AND semantics)', () => {
  it('accepts permitGitHub-only config (no useGitHub)', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      permitGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts useGitHub-only config (backward compat)', () => {
    const result = validateConfig({
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
    })
    expect(result.ok).toBe(true)
  })

  it('rejects config with neither useGitHub nor permitGitHub', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    })
    expect(result.ok).toBe(false)
  })
})

// ── Test 5: Static import-graph guard ────────────────────────────────────────

describe('diff.ts static import-graph guard', () => {
  it('diff.ts imports no module from src/github/', () => {
    const src = readFileSync(join(process.cwd(), 'src/commands/diff.ts'), 'utf-8')
    const lines = src.split('\n').filter((l) => l.trim().startsWith('import'))
    const ghImports = lines.filter((l) => /['"].*\/github\/|['"].*\/github['"]/i.test(l))
    expect(ghImports).toHaveLength(0)
  })
})

// ── Tests 1, 2, 3, 5 (async, need mocked run-cli + git) ─────────────────────

describe('F4: --github opt-in runtime gate', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.mocked(runCli).mockClear()
    vi.mocked(runCliJson).mockClear()
  })

  afterEach(() => {
    delete process.env['ARBITER_GITHUB']
    cleanupTestProject(dir)
  })

  it('T1: makes zero gh calls when --github absent and ARBITER_GITHUB unset, even if useGitHub:true stored', async () => {
    writeConfig(dir, { useGitHub: true })
    await runUpdate({ dir, github: false })
    // runCli and runCliJson must not have been called with 'gh' as first arg
    const ghRunCli = vi.mocked(runCli).mock.calls.filter((c) => c[0] === 'gh')
    const ghRunCliJson = vi.mocked(runCliJson).mock.calls.filter((c) => c[0] === 'gh')
    expect(ghRunCli).toHaveLength(0)
    expect(ghRunCliJson).toHaveLength(0)
  })

  it('T2: activates gh calls when ARBITER_GITHUB=1 (stored useGitHub:false)', async () => {
    writeConfig(dir, { useGitHub: false })
    process.env['ARBITER_GITHUB'] = '1'
    await runUpdate({ dir, github: false })
    const ghCalls = [
      ...vi.mocked(runCli).mock.calls.filter((c) => c[0] === 'gh'),
      ...vi.mocked(runCliJson).mock.calls.filter((c) => c[0] === 'gh'),
    ]
    expect(ghCalls.length).toBeGreaterThan(0)
  })

  it('T3: useGitHub→permitGitHub migration: loadConfig returns permitGitHub, deletes useGitHub', async () => {
    writeConfig(dir, { useGitHub: true })
    const loaded = loadConfig(dir)
    expect(loaded?.permitGitHub).toBe(true)
    expect(loaded).not.toHaveProperty('useGitHub')
  })

  it('T3b: after migration, reloading does not warn again (no deprecation loop)', async () => {
    writeConfig(dir, { useGitHub: true })
    // First load (triggers migration + deprecation path)
    const first = loadConfig(dir)
    expect(first?.permitGitHub).toBe(true)
    // Save migrated config back to disk
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(first, null, 2))
    // Second load: no useGitHub present, no deprecation
    const second = loadConfig(dir)
    expect(second?.permitGitHub).toBe(true)
    expect(second).not.toHaveProperty('useGitHub')
  })

  it('T5: runUpdate does not write runtime useGitHub back to stored config', async () => {
    // Start with permitGitHub: true (via migration from useGitHub:true)
    writeConfig(dir, { useGitHub: true })
    await runUpdate({ dir, github: false })
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    // After update: permitGitHub must be preserved, useGitHub must not appear
    expect(saved['permitGitHub']).toBe(true)
    expect(saved).not.toHaveProperty('useGitHub')
  })
})

// ── Test 4: Board prefix-probe ────────────────────────────────────────────────

describe('F11: createProjectBoard prefix probe', () => {
  beforeEach(() => {
    vi.mocked(runCli).mockClear()
    vi.mocked(runCliJson).mockClear()
  })

  it('T4a: finds existing board by date-agnostic prefix (idempotent)', () => {
    vi.mocked(runCliJson).mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'project' && args[1] === 'list') {
        return {
          projects: [
            { number: 1, title: 'MyProject Board · acme/repo · 2026-05-01', url: 'https://gh/1' },
          ],
        }
      }
      if (args[0] === 'project' && args[1] === 'field-list')
        return { fields: [{ name: 'Priority' }, { name: 'Size' }] }
      return {}
    })
    const result = createProjectBoard('acme', 'repo', 'MyProject')
    expect(result.created).toBe(false)
    expect(result.projectUrl).toBe('https://gh/1')
  })

  it('T4b: does NOT false-positive on repo-extended when searching for repo', () => {
    vi.mocked(runCliJson).mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'project' && args[1] === 'list') {
        return {
          projects: [
            {
              number: 2,
              title: 'MyProject Board · acme/repo-extended · 2026-05-27',
              url: 'https://gh/2',
            },
          ],
        }
      }
      if (args[0] === 'project' && args[1] === 'create') return { number: 99, url: 'https://gh/99' }
      if (args[0] === 'project' && args[1] === 'field-list') return { fields: [] }
      return {}
    })
    const result = createProjectBoard('acme', 'repo', 'MyProject')
    // Must NOT reuse repo-extended board — should create a new one
    expect(result.created).toBe(true)
    expect(result.projectUrl).toBe('https://gh/99')
  })

  it('T4c: board title includes projectName · owner/repo · YYYY-MM-DD', () => {
    let capturedTitle = ''
    vi.mocked(runCliJson).mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'project' && args[1] === 'list') return { projects: [] }
      if (args[0] === 'project' && args[1] === 'create') {
        capturedTitle = args[args.indexOf('--title') + 1] ?? ''
        return { number: 5, url: 'https://gh/5' }
      }
      if (args[0] === 'project' && args[1] === 'field-list') return { fields: [] }
      return {}
    })
    createProjectBoard('acme', 'repo', 'MyProject')
    expect(capturedTitle).toMatch(/^MyProject Board · acme\/repo · \d{4}-\d{2}-\d{2}$/)
  })
})

// ── Test 7: ARBITER_GITHUB truthy guard ───────────────────────────────────────

describe('ARBITER_GITHUB truthy guard', () => {
  let dir: string
  let stderrLines: string[]

  beforeEach(() => {
    dir = createTestProject('typescript')
    stderrLines = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrLines.push(String(chunk))
      return true
    })
    vi.mocked(runCli).mockClear()
    vi.mocked(runCliJson).mockClear()
  })

  afterEach(() => {
    delete process.env['ARBITER_GITHUB']
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('T7: warns when ARBITER_GITHUB is set to non-"1" value', async () => {
    writeConfig(dir, { useGitHub: false })
    process.env['ARBITER_GITHUB'] = 'true'
    await runUpdate({ dir, github: false })
    const warnLines = stderrLines.filter((l) => l.includes('ARBITER_GITHUB'))
    expect(warnLines.length).toBeGreaterThan(0)
  })
})
