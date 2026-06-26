// SPDX-License-Identifier: Apache-2.0
// TDD RED: #1047 — plugin-loader must survive '#' in targetDir path and reject
// NUL-byte injection. RED failures expected before Class A fix + path validation.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPlugin } from '../../../src/utils/plugin-loader.js'
import type { ArbiterConfig } from '../../../src/utils/config.js'

const PLUGIN_NAME = 'test-plugin'

function stagePlugin(baseDir: string): void {
  const pkgDir = join(baseDir, 'node_modules', PLUGIN_NAME)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    // `arbiter-plugin` keyword is required by the manifest validator now wired into
    // loadPlugin (#1562); a published plugin always declares it.
    JSON.stringify({
      name: PLUGIN_NAME,
      version: '0.0.1',
      main: 'index.js',
      keywords: ['arbiter-plugin'],
    }),
  )
  // CJS — `await import()` wraps module.exports as .default inside the worker.
  writeFileSync(
    join(pkgDir, 'index.js'),
    `module.exports = {
  name: '${PLUGIN_NAME}',
  apiVersion: '1',
  templateRoot: '.',
  generate() { return { files: [] } },
}\n`,
  )
}

// Minimal config that satisfies ArbiterConfig for worker invocation tests.
// The test plugin's generate() ignores the context, so actual field values don't matter.
const STUB_CONFIG: ArbiterConfig = {
  version: '0.1',
  $schemaVersion: 3,
  tools: [],
  governanceLevel: 'L1',
  useGitHub: false,
  features: {
    riskMatrixGating: false,
    requireStridePerFeature: false,
    piiScanEnabled: false,
    mutationTestingEnabled: false,
    licenseAuditEnabled: false,
  },
  thresholds: {
    lineCoverage: 60,
    branchCoverage: 60,
    mutationScore: 0,
    cyclomaticComplexity: 15,
    methodLength: 30,
    maxParams: 5,
  },
}

describe('#1047 — plugin-loader hash-path safety', () => {
  const staged: string[] = []

  afterEach(() => {
    for (const d of staged.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('loads plugin from targetDir containing "#"', async () => {
    const base = mkdtempSync(join(tmpdir(), 'arbiter-hash-'))
    const hashDir = join(base, '#1047-sub')
    mkdirSync(hashDir)
    stagePlugin(hashDir)
    staged.push(base)

    const plugin = await loadPlugin(PLUGIN_NAME, hashDir)
    expect(plugin.name).toBe(PLUGIN_NAME)
    expect(typeof plugin.generate).toBe('function')
  })

  it('loads plugin from clean path (regression guard)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'arbiter-clean-'))
    stagePlugin(base)
    staged.push(base)

    const plugin = await loadPlugin(PLUGIN_NAME, base)
    expect(plugin.name).toBe(PLUGIN_NAME)
    expect(typeof plugin.generate).toBe('function')
  })

  it('throws cleanly when targetDir contains NUL byte', async () => {
    await expect(loadPlugin(PLUGIN_NAME, '/tmp/valid\x00injected')).rejects.toThrow(
      /invalid.*targetDir|NUL|control character/i,
    )
  })

  it('throws cleanly when targetDir contains DEL (U+007F)', async () => {
    await expect(loadPlugin(PLUGIN_NAME, '/tmp/valid\x7finjected')).rejects.toThrow(
      /invalid.*targetDir|DEL|control character/i,
    )
  })

  it('throws cleanly when targetDir contains backslash on POSIX', async () => {
    await expect(loadPlugin(PLUGIN_NAME, '/tmp/valid\\injected')).rejects.toThrow(
      /invalid.*targetDir|backslash/i,
    )
  })

  it('worker: generate() succeeds via ESM import from "#"-path (native Node %23 decode)', async () => {
    // Proves that plugin-worker.ts pathToFileURL(entryPath).href is safe in native Node
    // worker_threads — Node 22 decodes %23 back to # when resolving file:// URLs,
    // unlike Vite's module resolver which was the root cause of the original bug.
    const base = mkdtempSync(join(tmpdir(), 'arbiter-wrkr-'))
    const hashDir = join(base, '#1047-worker-sub')
    mkdirSync(hashDir)
    stagePlugin(hashDir)
    staged.push(base)

    const plugin = await loadPlugin(PLUGIN_NAME, hashDir)
    const result = await plugin.generate({
      config: STUB_CONFIG,
      targetDir: hashDir,
      renderTemplate: () => '',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result.files)).toBe(true)
  }, 30_000)
})
