import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
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
  // Copy instead of symlink so require.resolve returns a path without '#' (worktree-safe)
  cpSync(join(FIXTURES_DIR, fixtureName), join(nmDir, pkgName), { recursive: true })
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

  it('worker renderTemplate tolerates absent basePackage (#1348)', async () => {
    installFixture(dir, 'render-basepackage-plugin', 'render-basepackage')
    const plugin = await loadPlugin('render-basepackage-plugin', dir)
    const result = await plugin.generate({
      config: {
        version: '0.1',
        projectName: 'demo',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      },
      targetDir: dir,
      renderTemplate: () => '',
    })
    expect(result.files).toHaveLength(1)
    // The worker's own renderTemplate normalized the absent basePackage key,
    // so the template's `|| 'com.example'` fallback ran instead of throwing.
    expect(result.files[0].content).toContain('package com.example.sample;')
    expect(result.files[0].content).toContain('// demo')
  })

  it('rejects a plugin that exports null (not an object)', async () => {
    installFixture(dir, 'null-export-plugin', 'null-export')
    await expect(loadPlugin('null-export-plugin', dir)).rejects.toThrow(/export a default object/)
  })

  it('rejects a plugin with invalid name (uppercase)', async () => {
    installFixture(dir, 'bad-name-plugin', 'bad-name')
    await expect(loadPlugin('bad-name-plugin', dir)).rejects.toThrow(/invalid name/)
  })

  it("rejects a plugin with apiVersion !== '1'", async () => {
    installFixture(dir, 'bad-apiversion-plugin', 'bad-apiversion-plugin')
    await expect(loadPlugin('bad-apiversion-plugin', dir)).rejects.toThrow(/apiVersion "1"/)
  })

  it('rejects a plugin missing generate function', async () => {
    installFixture(dir, 'bad-shape-plugin', 'bad-shape-plugin')
    await expect(loadPlugin('bad-shape-plugin', dir)).rejects.toThrow(/missing required generate/)
  })

  it('rejects a plugin with non-string templateRoot', async () => {
    installFixture(dir, 'no-template-root-plugin', 'no-template-root')
    await expect(loadPlugin('no-template-root-plugin', dir)).rejects.toThrow(/templateRoot/)
  })

  it('rejects a plugin where detect is not a function', async () => {
    installFixture(dir, 'bad-detect-type-plugin', 'bad-detect-type')
    await expect(loadPlugin('bad-detect-type-plugin', dir)).rejects.toThrow(/detect.*function/)
  })

  it('rejects a plugin where verifyPlanRules is not an array', async () => {
    installFixture(dir, 'bad-verify-rules-plugin', 'bad-verify-rules')
    await expect(loadPlugin('bad-verify-rules-plugin', dir)).rejects.toThrow(
      /verifyPlanRules.*array/,
    )
  })

  it('rejects a plugin whose package.json manifest is invalid (#1562)', async () => {
    // Manifest lacks the mandatory `arbiter-plugin` keyword — the schema validator
    // (previously dead production code) is now wired into the runtime load path.
    installFixture(dir, 'bad-manifest-plugin', 'bad-manifest')
    await expect(loadPlugin('bad-manifest-plugin', dir)).rejects.toThrow(
      /invalid package\.json manifest|arbiter-plugin/,
    )
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

  it('SIGINT mid-call rejects with interrupted-by-signal error', async () => {
    installFixture(dir, 'hanging-plugin', 'hanging')
    const plugin = await loadPlugin('hanging-plugin', dir, { invokeTimeoutMs: 30_000 })
    const generatePromise = plugin.generate({
      config: { version: '0.1', tools: ['claude'], governanceLevel: 'L2', useGitHub: false },
      targetDir: dir,
      renderTemplate: () => '',
    })
    // Allow worker to start before simulating the signal
    await new Promise<void>((r) => setTimeout(r, 200))
    // Call the most recently added SIGINT listener directly (avoids killing the process)
    const listeners = process.rawListeners('SIGINT') as ((...args: unknown[]) => void)[]
    listeners[listeners.length - 1]!()
    await expect(generatePromise).rejects.toThrow(/interrupted by signal/)
  }, 10_000)
})

describe('plugin invariants (#2035, TC-5)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('forwards a plugin-declared invariants array through the proxy', async () => {
    installFixture(dir, 'invariants-plugin', 'invariants-plugin')
    const plugin = await loadPlugin('invariants-plugin', dir)
    expect(plugin.invariants).toBeDefined()
    expect(plugin.invariants).toHaveLength(1)
    expect(plugin.invariants?.[0]?.id).toBe('PROJ-01')
    expect(plugin.invariants?.[0]?.tier).toBe('governance')
  })

  it('rejects a plugin whose invariants use the reserved INV-NN namespace', async () => {
    installFixture(dir, 'invariants-bad-plugin', 'invariants-bad')
    await expect(loadPlugin('invariants-bad-plugin', dir)).rejects.toThrow(/invariants-bad-plugin/)
    await expect(loadPlugin('invariants-bad-plugin', dir)).rejects.toThrow(/PROJ-/)
  })

  it('does not forward invariants when the plugin declares none', async () => {
    installFixture(dir, 'mock-arbiter-plugin', 'mock-plugin')
    const plugin = await loadPlugin('mock-arbiter-plugin', dir)
    expect(plugin.invariants).toBeUndefined()
  })
})
