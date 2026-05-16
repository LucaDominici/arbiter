// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePluginPackageJson } from '../../src/integrations/plugin-schema.js'
import { runPluginListValidate } from '../../src/commands/plugin.js'

describe('validatePluginPackageJson (#570)', () => {
  const VALID_PKG = {
    name: 'arbiter-plugin-spring-boot',
    version: '0.1.0',
    keywords: ['arbiter', 'arbiter-plugin'],
    main: 'dist/index.js',
    peerDependencies: { '@arbiter/cli': '*' },
  }

  it('passes a valid plugin package.json', () => {
    const result = validatePluginPackageJson(VALID_PKG)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails when arbiter-plugin keyword is missing', () => {
    const result = validatePluginPackageJson({ ...VALID_PKG, keywords: ['arbiter'] })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails when version is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version: _v, ...rest } = VALID_PKG
    const result = validatePluginPackageJson(rest)
    expect(result.ok).toBe(false)
  })

  it('fails when keywords array is absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keywords: _k, ...rest } = VALID_PKG
    const result = validatePluginPackageJson(rest)
    expect(result.ok).toBe(false)
  })

  it('fails when name is not a valid npm package name', () => {
    const result = validatePluginPackageJson({ ...VALID_PKG, name: 'INVALID NAME!' })
    expect(result.ok).toBe(false)
  })
})

describe('runPluginListValidate (#570)', () => {
  let dir: string
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-plugin-validate-'))
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    exitSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits when no arbiter.json present', () => {
    expect(() => runPluginListValidate({ dir })).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('returns empty array when plugins list is empty', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ version: '1', tools: ['claude'], level: 'L1', plugins: [] }),
    )
    const results = runPluginListValidate({ dir })
    expect(results).toEqual([])
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('')
    expect(output).toContain('No plugins configured')
  })

  it('exits non-zero and reports FAIL for an unresolvable plugin', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '1',
        tools: ['claude'],
        level: 'L1',
        plugins: ['nonexistent-pkg-xyz'],
      }),
    )
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    expect(() => runPluginListValidate({ dir })).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('')
    expect(out).toContain('FAIL')
    expect(out).toContain('nonexistent-pkg-xyz')
  })

  it('json mode emits results object', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ version: '1', tools: ['claude'], level: 'L1', plugins: [] }),
    )
    runPluginListValidate({ dir, json: true })
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('')
    const parsed = JSON.parse(out)
    expect(parsed).toHaveProperty('data.results')
  })
})
