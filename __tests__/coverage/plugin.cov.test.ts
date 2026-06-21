// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runPluginInit,
  runPluginAdd,
  runPluginRemove,
  runPluginList,
} from '../../src/commands/plugin.js'
import type { ArbiterConfig } from '../../src/utils/config.js'

// Mock the two DI seams the command imports directly so no real config IO,
// plugin resolution, or network lookup occurs. `loadPlugin` is given a default
// resolved value so any code path that does not override it is deterministic.
vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/utils/plugin-loader.js', () => ({
  loadPlugin: vi.fn().mockResolvedValue(undefined),
}))

import { loadConfig, saveConfig } from '../../src/utils/config.js'
import { loadPlugin } from '../../src/utils/plugin-loader.js'

const mockLoadConfig = vi.mocked(loadConfig)
const mockSaveConfig = vi.mocked(saveConfig)
const mockLoadPlugin = vi.mocked(loadPlugin)

// A fully-typed stored config WITHOUT a `plugins` field, used to exercise the
// `stored.plugins ?? []` nullish branch in runPluginRemove.
const CONFIG_NO_PLUGINS: ArbiterConfig = {
  version: '0.1',
  governanceLevel: 'L1',
  tools: ['claude'],
  useGitHub: false,
  features: {
    debtGates: false,
    suppressions: false,
    securityScanning: false,
    mutationTesting: false,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {},
}

describe('plugin.ts branch coverage', () => {
  let stdout: string
  let stderr: string

  beforeEach(() => {
    stdout = ''
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown): boolean => {
      stderr += String(chunk)
      return true
    })
    mockLoadConfig.mockReset()
    mockSaveConfig.mockReset().mockResolvedValue(undefined)
    mockLoadPlugin.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- runPluginInit ----

  describe('runPluginInit', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-plugin-cov-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('emits a JSON envelope and skips human output when json is set', async () => {
      await runPluginInit('jsoner', { dir: tmpDir, json: true })
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      expect(parsed.command).toBe('plugin-init')
      expect(parsed.status).toBe('ok')
      const data = parsed.data as Record<string, unknown>
      expect(data.name).toBe('jsoner')
      expect(data.pkgName).toBe('arbiter-plugin-jsoner')
      // Human "Scaffolded plugin" banner must be absent on the json path.
      expect(stdout).not.toMatch(/Scaffolded/i)
      // Files were still written to disk.
      expect(existsSync(join(tmpDir, 'arbiter-plugin-jsoner', 'package.json'))).toBe(true)
    })

    it('defaults the parent dir to process.cwd() when no dir option is given', async () => {
      const prevCwd = process.cwd()
      process.chdir(tmpDir)
      try {
        await runPluginInit('cwd-default', {})
        // Written relative to the (temporarily) changed cwd => exercises the
        // `opts.dir ?? process.cwd()` nullish branch.
        expect(existsSync(join(tmpDir, 'arbiter-plugin-cwd-default', 'package.json'))).toBe(true)
        const pkg = JSON.parse(
          readFileSync(join(tmpDir, 'arbiter-plugin-cwd-default', 'package.json'), 'utf-8'),
        ) as Record<string, unknown>
        expect(pkg['name']).toBe('arbiter-plugin-cwd-default')
        // Human banner printed on the non-json path.
        expect(stdout).toMatch(/Scaffolded/i)
      } finally {
        process.chdir(prevCwd)
      }
    })
  })

  // ---- runPluginAdd ----

  describe('runPluginAdd', () => {
    it('exits non-json when no arbiter.json exists (stderr + process.exit)', async () => {
      mockLoadConfig.mockReturnValue(null)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit')
      })
      await expect(runPluginAdd({ dir: '/nope', pkg: 'p' })).rejects.toThrow('process.exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderr.length).toBeGreaterThan(0)
      // The error envelope (json path) must NOT have been printed to stdout.
      expect(stdout).toBe('')
    })

    it('stringifies a non-Error rejection from loadPlugin (String(err) branch)', async () => {
      // runPluginAdd does real fs work (mkdir .arbiter + lock) past the guard,
      // so it needs a writable directory.
      const work = mkdtempSync(join(tmpdir(), 'arbiter-plugin-add-'))
      try {
        mockLoadConfig.mockReturnValue({ ...CONFIG_NO_PLUGINS })
        // A thrown string (not an Error) drives `err instanceof Error ? ... : String(err)`.
        mockLoadPlugin.mockRejectedValue('plain string failure' as unknown as Error)
        await expect(runPluginAdd({ dir: work, pkg: 'p' })).rejects.toThrow(/plain string failure/)
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    })
  })

  // ---- runPluginRemove ----

  describe('runPluginRemove', () => {
    it('emits a JSON error envelope and exits when no arbiter.json exists', async () => {
      mockLoadConfig.mockReturnValue(null)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit')
      })
      await expect(
        runPluginRemove({ dir: '/nope', pkg: 'p', json: true }),
      ).rejects.toThrow('process.exit')
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      expect(parsed.command).toBe('plugin-remove')
      expect(parsed.status).toBe('error')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('exits non-json when no arbiter.json exists (stderr + process.exit)', async () => {
      mockLoadConfig.mockReturnValue(null)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit')
      })
      await expect(runPluginRemove({ dir: '/nope', pkg: 'p' })).rejects.toThrow('process.exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderr.length).toBeGreaterThan(0)
      expect(stdout).toBe('')
    })

    it('treats a missing plugins field as an empty array (?? [] branch)', async () => {
      // Config object intentionally has no `plugins` key.
      mockLoadConfig.mockReturnValue({ ...CONFIG_NO_PLUGINS })
      await runPluginRemove({ dir: '/nope', pkg: 'absent' })
      expect(mockSaveConfig).toHaveBeenCalledTimes(1)
      const savedArg = mockSaveConfig.mock.calls[0]?.[1] as { plugins: string[] }
      expect(savedArg.plugins).toEqual([])
      expect(stdout).toMatch(/absent/)
    })
  })

  // ---- runPluginList ----

  describe('runPluginList', () => {
    it('emits a JSON error envelope and exits when no arbiter.json exists', async () => {
      mockLoadConfig.mockReturnValue(null)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit')
      })
      await expect(runPluginList({ dir: '/nope', json: true })).rejects.toThrow('process.exit')
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      expect(parsed.command).toBe('plugin-list')
      expect(parsed.status).toBe('error')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('exits non-json when no arbiter.json exists (stderr + process.exit)', async () => {
      mockLoadConfig.mockReturnValue(null)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
        throw new Error('process.exit')
      })
      await expect(runPluginList({ dir: '/nope' })).rejects.toThrow('process.exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderr.length).toBeGreaterThan(0)
      expect(stdout).toBe('')
    })

    it('reports an Error rejection via err.message in the JSON status', async () => {
      mockLoadConfig.mockReturnValue({ ...CONFIG_NO_PLUGINS, plugins: ['p'] })
      // A real Error drives the `err.message` (true) arm of the ternary.
      mockLoadPlugin.mockRejectedValue(new Error('module not installed\nstack frame'))
      await runPluginList({ dir: '/nope', json: true })
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      const data = parsed.data as Record<string, unknown>
      const plugins = data.plugins as Array<Record<string, unknown>>
      expect(String(plugins[0]?.status)).toContain('not loadable: module not installed')
      // Only the first line of a multi-line message is surfaced.
      expect(String(plugins[0]?.status)).not.toContain('stack frame')
    })

    it('stringifies a non-Error rejection in the JSON status (String(err) branch)', async () => {
      mockLoadConfig.mockReturnValue({ ...CONFIG_NO_PLUGINS, plugins: ['p'] })
      mockLoadPlugin.mockRejectedValue('raw json failure' as unknown as Error)
      await runPluginList({ dir: '/nope', json: true })
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      const data = parsed.data as Record<string, unknown>
      const plugins = data.plugins as Array<Record<string, unknown>>
      expect(plugins[0]?.pkg).toBe('p')
      expect(String(plugins[0]?.status)).toContain('raw json failure')
    })

    it('stringifies a non-Error rejection in the human status (String(err) branch)', async () => {
      mockLoadConfig.mockReturnValue({ ...CONFIG_NO_PLUGINS, plugins: ['p'] })
      mockLoadPlugin.mockRejectedValue('raw human failure' as unknown as Error)
      await runPluginList({ dir: '/nope' })
      expect(stdout).toContain('raw human failure')
      expect(stdout).toContain('p')
    })
  })
})
