import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runPluginInit } from '../../src/commands/plugin.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-plugin-init-'))
}

describe('runPluginInit', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates package.json with correct name, main, and types fields', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    const pkgPath = join(tmpDir, 'arbiter-plugin-my-scanner', 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    expect(pkg['name']).toBe('arbiter-plugin-my-scanner')
    expect(pkg['main']).toBe('dist/index.js')
    expect(pkg['types']).toBe('dist/index.d.ts')
  })

  it('creates src/index.ts referencing ArbiterPlugin', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    const indexPath = join(tmpDir, 'arbiter-plugin-my-scanner', 'src', 'index.ts')
    expect(existsSync(indexPath)).toBe(true)
    const content = readFileSync(indexPath, 'utf-8')
    expect(content).toContain('ArbiterPlugin')
  })

  it('creates tsconfig.json', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    const tsconfig = join(tmpDir, 'arbiter-plugin-my-scanner', 'tsconfig.json')
    expect(existsSync(tsconfig)).toBe(true)
  })

  it('creates templates directory placeholder', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    const gitkeep = join(tmpDir, 'arbiter-plugin-my-scanner', 'templates', '.gitkeep')
    expect(existsSync(gitkeep)).toBe(true)
  })

  it('creates src/__tests__/plugin.test.ts render test scaffold', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    const testPath = join(tmpDir, 'arbiter-plugin-my-scanner', 'src', '__tests__', 'plugin.test.ts')
    expect(existsSync(testPath)).toBe(true)
  })

  it('is idempotent — second run does not throw and skips existing files', async () => {
    await runPluginInit('my-scanner', { dir: tmpDir })
    await expect(runPluginInit('my-scanner', { dir: tmpDir })).resolves.not.toThrow()
    // Package name is still correct after second run
    const pkgPath = join(tmpDir, 'arbiter-plugin-my-scanner', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    expect(pkg['name']).toBe('arbiter-plugin-my-scanner')
  })

  it('places output in dir/arbiter-plugin-<name>/', async () => {
    await runPluginInit('cool-tool', { dir: tmpDir })
    const pkgDir = join(tmpDir, 'arbiter-plugin-cool-tool')
    expect(existsSync(pkgDir)).toBe(true)
  })

  it('handles names with hyphens correctly', async () => {
    await runPluginInit('my-cool-tool', { dir: tmpDir })
    const pkgPath = join(tmpDir, 'arbiter-plugin-my-cool-tool', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    expect(pkg['name']).toBe('arbiter-plugin-my-cool-tool')
  })
})
