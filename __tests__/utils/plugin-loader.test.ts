import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from '../../src/utils/plugin-loader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../fixtures/plugins')

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-plugin-loader-test-'))
}

function installFixture(dir: string, pkgName: string, fixtureName: string): void {
  const nmDir = join(dir, 'node_modules')
  mkdirSync(nmDir, { recursive: true })
  symlinkSync(join(FIXTURES_DIR, fixtureName), join(nmDir, pkgName))
}

describe('loadPlugin', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves a valid plugin from targetDir/node_modules', async () => {
    installFixture(dir, 'mock-arbiter-plugin', 'mock-plugin')
    const plugin = await loadPlugin('mock-arbiter-plugin', dir)
    expect(plugin.name).toBe('mock-arbiter-plugin')
    expect(plugin.apiVersion).toBe('1')
    expect(typeof plugin.generate).toBe('function')
  })

  it('plugin generate returns files with expected shape', async () => {
    installFixture(dir, 'mock-arbiter-plugin', 'mock-plugin')
    const plugin = await loadPlugin('mock-arbiter-plugin', dir)
    const result = await plugin.generate({
      config: {
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      },
      targetDir: dir,
      renderTemplate: () => '',
    })
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toContain('mock-output.txt')
  })

  it("rejects a plugin with apiVersion !== '1'", async () => {
    installFixture(dir, 'bad-apiversion-plugin', 'bad-apiversion-plugin')
    await expect(loadPlugin('bad-apiversion-plugin', dir)).rejects.toThrow(/apiVersion "1"/)
  })

  it('rejects a plugin missing generate function', async () => {
    installFixture(dir, 'bad-shape-plugin', 'bad-shape-plugin')
    await expect(loadPlugin('bad-shape-plugin', dir)).rejects.toThrow(/missing required generate/)
  })

  it('throws a descriptive error when package is not installed', async () => {
    await expect(loadPlugin('nonexistent-plugin', dir)).rejects.toThrow(/not found/)
  })

  it('hanging plugin times out and rejects with UserFacingError', async () => {
    installFixture(dir, 'hanging-plugin', 'hanging')
    const plugin = await loadPlugin('hanging-plugin', dir, { invokeTimeoutMs: 2_000 })
    await expect(
      plugin.generate({
        config: { version: '0.1', tools: ['claude'], governanceLevel: 'L2', useGitHub: false },
        targetDir: dir,
        renderTemplate: () => '',
      }),
    ).rejects.toThrow(/timed out/)
  }, 10_000)

  it('throwing plugin surfaces error through message port', async () => {
    installFixture(dir, 'throwing-plugin', 'throwing')
    const plugin = await loadPlugin('throwing-plugin', dir)
    await expect(
      plugin.generate({
        config: { version: '0.1', tools: ['claude'], governanceLevel: 'L2', useGitHub: false },
        targetDir: dir,
        renderTemplate: () => '',
      }),
    ).rejects.toThrow(/plugin generate failed intentionally/)
  })

  it('crashing plugin rejects with exit code error', async () => {
    installFixture(dir, 'crashing-plugin', 'crashing')
    const plugin = await loadPlugin('crashing-plugin', dir)
    await expect(
      plugin.generate({
        config: { version: '0.1', tools: ['claude'], governanceLevel: 'L2', useGitHub: false },
        targetDir: dir,
        renderTemplate: () => '',
      }),
    ).rejects.toThrow(/crashed.*exit code/)
  })

  it('detect() invocation runs in worker and returns boolean', async () => {
    installFixture(dir, 'detecting-plugin', 'detecting')
    const plugin = await loadPlugin('detecting-plugin', dir)
    expect(typeof plugin.detect).toBe('function')
    const result = await plugin.detect!({
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    })
    expect(result).toBe(true)
  })
})
