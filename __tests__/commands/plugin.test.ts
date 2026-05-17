import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runPluginAdd, runPluginRemove, runPluginList } from '../../src/commands/plugin.js'
import type { ArbiterPlugin } from '../../src/types/plugin.js'
import * as pluginLoader from '../../src/utils/plugin-loader.js'
import * as configUtils from '../../src/utils/config.js'

vi.mock('../../src/utils/plugin-loader.js', () => ({
  loadPlugin: vi.fn(),
}))

const BASE_CONFIG = {
  version: '0.1',
  tools: ['claude'],
  governanceLevel: 'L2',
  useGitHub: false,
}

const MOCK_PLUGIN: ArbiterPlugin = {
  name: 'test-plugin',
  apiVersion: '1',
  templateRoot: '/tmp/test',
  generate: () => ({ files: [] }),
}

describe('runPluginAdd', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(BASE_CONFIG))
    vi.mocked(pluginLoader.loadPlugin).mockResolvedValue(MOCK_PLUGIN)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('persists the package to the plugins array in arbiter.json', async () => {
    await runPluginAdd({ dir, pkg: '@company/arbiter-spring-boot' })
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    expect(saved.plugins).toContain('@company/arbiter-spring-boot')
  })

  it('emits a security advisory mentioning the package', async () => {
    await runPluginAdd({ dir, pkg: '@company/arbiter-spring-boot' })
    const logs = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logs).toMatch(/Security advisory/i)
    expect(logs).toContain('@company/arbiter-spring-boot')
  })

  it('is idempotent — adding the same package twice produces no duplicates', async () => {
    await runPluginAdd({ dir, pkg: 'my-plugin' })
    await runPluginAdd({ dir, pkg: 'my-plugin' })
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    expect((saved.plugins as string[]).filter((p) => p === 'my-plugin')).toHaveLength(1)
  })

  it('throws and leaves arbiter.json unchanged when plugin is not resolvable', async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValue(
      new Error('Plugin not found in node_modules'),
    )
    await expect(runPluginAdd({ dir, pkg: 'nonexistent' })).rejects.toThrow(/Plugin not found/)
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    expect(saved.plugins).toBeUndefined()
  })

  it('leaves arbiter.json byte-identical when saveConfig throws after loadPlugin succeeds (#612)', async () => {
    const original = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    vi.spyOn(configUtils, 'saveConfig').mockImplementation(() => {
      throw new Error('ENOSPC: disk full')
    })
    await expect(runPluginAdd({ dir, pkg: 'my-plugin' })).rejects.toThrow(/ENOSPC/)
    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(original)
  })

  it('surfaces a retry suggestion when loadPlugin fails with a network-like error (#612)', async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValueOnce(
      new Error('npm registry unreachable: ETIMEDOUT'),
    )
    const original = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    await expect(runPluginAdd({ dir, pkg: 'my-plugin' })).rejects.toThrow(
      /arbiter plugin add my-plugin/i,
    )
    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(original)
  })

  it('error message documents that arbiter.json was not modified (#612 transaction order)', async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValueOnce(new Error('boom'))
    await expect(runPluginAdd({ dir, pkg: 'my-plugin' })).rejects.toThrow(/not modified/i)
  })
})

describe('runPluginRemove', () => {
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

  it('removes the plugin from the plugins array', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        ...BASE_CONFIG,
        plugins: ['keep-plugin', 'remove-plugin'],
      }),
    )
    await runPluginRemove({ dir, pkg: 'remove-plugin' })
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    expect(saved.plugins).not.toContain('remove-plugin')
    expect(saved.plugins).toContain('keep-plugin')
  })

  it('is a no-op when the plugin is not in the array', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ ...BASE_CONFIG, plugins: ['other-plugin'] }),
    )
    await runPluginRemove({ dir, pkg: 'nonexistent' })
    const saved = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    expect(saved.plugins).toEqual(['other-plugin'])
  })
})

describe('runPluginList', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.mocked(pluginLoader.loadPlugin).mockResolvedValue(MOCK_PLUGIN)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('prints configured plugins with resolved status', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ ...BASE_CONFIG, plugins: ['my-plugin'] }),
    )
    await runPluginList({ dir })
    const logs = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logs).toContain('my-plugin')
    expect(logs).toContain('resolved')
  })

  it("shows 'not loadable: <message>' when plugin resolution fails", async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValue(new Error('not installed'))
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ ...BASE_CONFIG, plugins: ['missing-plugin'] }),
    )
    await runPluginList({ dir })
    const logs = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logs).toContain('missing-plugin')
    expect(logs).toContain('not loadable: not installed')
  })

  it('surfaces the first line of a multi-line error in the status', async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValue(
      new Error('SyntaxError: unexpected token\n    at Module._compile'),
    )
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ ...BASE_CONFIG, plugins: ['bad-plugin'] }),
    )
    await runPluginList({ dir })
    const logs = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logs).toContain('not loadable: SyntaxError: unexpected token')
    expect(logs).not.toContain('at Module._compile')
  })

  it('prints an empty message when no plugins are configured', async () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(BASE_CONFIG))
    await runPluginList({ dir })
    const logs = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logs).toMatch(/No plugins/i)
  })
})
