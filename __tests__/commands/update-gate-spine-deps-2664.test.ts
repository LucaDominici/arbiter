// SPDX-License-Identifier: Apache-2.0
// #2664: unit (non-`__tests__/integration/**`) coverage for the branches in
// `widenOnlyForGateSpineDeps`/`printAdoptPlan` that only the integration
// suite (`update-gate-spine-only-deps-2664.test.ts`, excluded from the unit
// coverage run by `vitest.config.ts`) previously exercised. Same behavior,
// same non-mocked `runUpdate` entry point — placed here purely so the
// coverage instrumentation sees it. `widenOnlyForGateSpineDeps`/
// `printAdoptPlan` stay unexported; every scenario below drives them through
// `runUpdate`, already a public entry point.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../src/state/generated-manifest.js'

async function initProject(dir: string): Promise<void> {
  await runInit({
    yes: true,
    tools: 'claude',
    level: 'L1',
    dir,
    dryRun: false,
    brownfield: false,
    noVerify: true,
    language: 'typescript',
    archetype: 'library',
  })
}

function customizeSpine(dir: string): void {
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
  )
}

function captureStdout(): { out: string[]; restore: () => void } {
  const out: string[] = []
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      out.push(String(chunk))
      return true
    })
  return { out, restore: () => spy.mockRestore() }
}

describe('#2664 unit coverage: widenOnlyForGateSpineDeps early return / no-widening-needed', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('--only targeting a different file (not scripts/check-all.mjs) takes the early return', async () => {
    await initProject(dir)
    // adoptGateSpine is set, but --only never matches scripts/check-all.mjs —
    // widenOnlyForGateSpineDeps must return `only` unchanged without ever
    // rendering the spine or computing a closure.
    await runUpdate({
      dir,
      json: true,
      github: false,
      adoptGateSpine: true,
      only: ['scripts/lib/run-helpers.mjs'],
    })
    // Untouched: gate-mutex.mjs was never a widening candidate.
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(true)
  }, 60_000)

  it('an intact lib dir needs no widening (added.length === 0 branch)', async () => {
    await initProject(dir)
    customizeSpine(dir)
    // No file deleted this time — every resolved dependency is already on
    // disk, so `added` stays empty and `only` is returned as-is.
    await runUpdate({
      dir,
      json: true,
      github: false,
      adoptGateSpine: true,
      only: ['scripts/check-all.mjs'],
    })
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(true)
  }, 60_000)

  it('a missing dependency excluded by .arbiterignore refuses (ignoredMissing branch)', async () => {
    await initProject(dir)
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    writeFileSync(join(dir, '.arbiterignore'), 'scripts/lib/gate-mutex.mjs\n')
    customizeSpine(dir)

    await expect(
      runUpdate({
        dir,
        json: true,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
      }),
    ).rejects.toThrow(/gate-mutex\.mjs/)
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(false)
  }, 60_000)
})

describe('#2664 unit coverage: printAdoptPlan json/text and the wouldCreateDeps filter', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  async function missingDepProject(): Promise<void> {
    await initProject(dir)
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    const manifest = loadGeneratedManifest(dir)
    delete manifest['scripts/lib/gate-mutex.mjs']
    saveGeneratedManifest(dir, manifest)
    customizeSpine(dir)
  }

  it('json mode: wouldCreateGateSpineDependencies non-empty (action created, in gateSpineDeps)', async () => {
    await missingDepProject()
    const { out, restore } = captureStdout()
    try {
      await runUpdate({
        dir,
        json: true,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
        adoptPlan: true,
      })
    } finally {
      restore()
    }
    const payload = JSON.parse(out.join('')) as {
      data: { wouldCreateGateSpineDependencies: string[] }
    }
    expect(payload.data.wouldCreateGateSpineDependencies).toContain('scripts/lib/gate-mutex.mjs')
  }, 60_000)

  it('text mode: prints the "would create" gate-spine-dependency block', async () => {
    await missingDepProject()
    const { out, restore } = captureStdout()
    try {
      await runUpdate({
        dir,
        json: false,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
        adoptPlan: true,
      })
    } finally {
      restore()
    }
    const text = out.join('')
    expect(text).toContain('would create')
    expect(text).toContain('gate-mutex.mjs')
  }, 60_000)

  it('text mode: an intact lib dir plan has an empty wouldCreateDeps bucket', async () => {
    await initProject(dir)
    customizeSpine(dir)
    const { out, restore } = captureStdout()
    try {
      await runUpdate({
        dir,
        json: false,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
        adoptPlan: true,
      })
    } finally {
      restore()
    }
    expect(out.join('')).not.toContain('gate-spine dependency')
  }, 60_000)
})
