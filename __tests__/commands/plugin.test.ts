// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestProject, cleanupTestProject, DEFAULT_THRESHOLDS } from '../helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../fixtures/plugins')

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(() => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 })),
}))

import { runPluginAdd, runPluginList } from '../../src/commands/plugin.js'
import { runCli } from '../../src/utils/run-cli.js'

const mockRunCli = vi.mocked(runCli)

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

/** Copy the mock-plugin fixture to `dir/<relPath>` so it resolves as a local path plugin. */
function installLocal(dir: string, relPath: string): void {
  cpSync(join(FIXTURES_DIR, 'mock-plugin'), join(dir, relPath), { recursive: true })
}

/** Copy the mock-plugin fixture to `dir/node_modules/<pkgName>` so it resolves as an npm plugin. */
function installNodeModules(dir: string, pkgName: string): void {
  const nmDir = join(dir, 'node_modules')
  mkdirSync(nmDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'mock-plugin'), join(nmDir, pkgName), { recursive: true })
}

describe('runPluginAdd', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    mockRunCli.mockClear()
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('adds a local-path plugin without invoking the package manager (AC-3)', async () => {
    writeV2Config(dir)
    installLocal(dir, 'my-plugin')

    await runPluginAdd({ dir, pkg: './my-plugin', install: true })

    expect(mockRunCli).not.toHaveBeenCalled()
    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['./my-plugin'])
  })

  it('adds an npm-name plugin by installing it as a devDependency first (AC-4)', async () => {
    writeV2Config(dir)
    // Simulate the install having succeeded by pre-seeding node_modules; the
    // mocked runCli never actually runs npm.
    installNodeModules(dir, 'mock-arbiter-plugin')

    await runPluginAdd({ dir, pkg: 'mock-arbiter-plugin', install: true })

    expect(mockRunCli).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = mockRunCli.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(cmd).toBe('npm')
    expect(args).toContain('mock-arbiter-plugin')
    expect(args).toContain('--save-dev')
    expect(opts?.cwd).toBe(dir)

    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['mock-arbiter-plugin'])
  })

  it('--no-install (install:false) skips the package-manager step', async () => {
    writeV2Config(dir)
    installNodeModules(dir, 'mock-arbiter-plugin')

    await runPluginAdd({ dir, pkg: 'mock-arbiter-plugin', install: false })

    expect(mockRunCli).not.toHaveBeenCalled()
    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['mock-arbiter-plugin'])
  })

  it('strips a trailing @version from the persisted plugins[] entry', async () => {
    writeV2Config(dir)
    installNodeModules(dir, 'mock-arbiter-plugin')

    await runPluginAdd({ dir, pkg: 'mock-arbiter-plugin@1.0.0', install: true })

    const [, installArgs] = mockRunCli.mock.calls[0] as [string, string[]]
    expect(installArgs).toContain('mock-arbiter-plugin@1.0.0')

    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['mock-arbiter-plugin'])
  })

  it('is idempotent — re-adding an already-configured plugin does not duplicate it (AC-5)', async () => {
    writeV2Config(dir)
    installLocal(dir, 'my-plugin')

    await runPluginAdd({ dir, pkg: './my-plugin', install: true })
    await runPluginAdd({ dir, pkg: './my-plugin', install: true })

    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['./my-plugin'])
  })

  it('keeps plugins[] sorted after adding a second plugin', async () => {
    writeV2Config(dir)
    installLocal(dir, 'zzz-plugin')
    installLocal(dir, 'aaa-plugin')

    await runPluginAdd({ dir, pkg: './zzz-plugin', install: true })
    await runPluginAdd({ dir, pkg: './aaa-plugin', install: true })

    const raw = readArbiterJson(dir)
    expect(raw['plugins']).toEqual(['./aaa-plugin', './zzz-plugin'])
  })

  it('does not modify arbiter.json when the plugin fails to resolve', async () => {
    writeV2Config(dir)
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')

    await expect(runPluginAdd({ dir, pkg: './does-not-exist', install: true })).rejects.toThrow()

    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(before)
  })

  it('throws when no arbiter.json exists', async () => {
    await expect(runPluginAdd({ dir, pkg: './my-plugin', install: true })).rejects.toThrow()
  })

  it('--json emits an error envelope and exits 1 when arbiter.json is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    let written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })

    await expect(
      runPluginAdd({ dir, pkg: './my-plugin', install: true, json: true }),
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
  })

  it('--json emits an ok envelope with the resolved name on success', async () => {
    writeV2Config(dir)
    installLocal(dir, 'my-plugin')
    let written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })

    await runPluginAdd({ dir, pkg: './my-plugin', install: true, json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('plugin add')
    expect(parsed.status).toBe('ok')
    expect(parsed.data).toMatchObject({ name: './my-plugin' })
  })
})

describe('runPluginList', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('reports a distinct message when no plugins are configured (AC-6)', async () => {
    writeV2Config(dir)
    let written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })

    await runPluginList({ dir })

    expect(written.toLowerCase()).toContain('no plugin')
    vi.restoreAllMocks()
  })

  it('lists configured plugins with load status (loaded / not found) (AC-6)', async () => {
    installLocal(dir, 'my-plugin')
    writeV2Config(dir, { plugins: ['./my-plugin', './missing-plugin'] })
    let written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })

    await runPluginList({ dir })

    expect(written).toContain('./my-plugin')
    expect(written.toLowerCase()).toContain('loaded')
    expect(written).toContain('./missing-plugin')
    expect(written.toLowerCase()).toContain('not found')
    vi.restoreAllMocks()
  })

  it('--json emits a status per configured plugin', async () => {
    installLocal(dir, 'my-plugin')
    writeV2Config(dir, { plugins: ['./my-plugin'] })
    let written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })

    await runPluginList({ dir, json: true })

    const parsed = JSON.parse(written) as { data: { plugins: { name: string; status: string }[] } }
    expect(parsed.data.plugins).toEqual([{ name: './my-plugin', status: 'loaded' }])
    vi.restoreAllMocks()
  })
})
