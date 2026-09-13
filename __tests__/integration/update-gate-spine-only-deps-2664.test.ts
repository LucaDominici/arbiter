// SPDX-License-Identifier: Apache-2.0
// #2664: `update --adopt-gate-spine --only scripts/check-all.mjs` must not land
// a spine that imports a `./lib/*.mjs` module it did not also emit. Repro: a
// project whose `scripts/lib/gate-mutex.mjs` predates the spine's import of it
// (deleted here to simulate the stale lib dir) plus a user-modified
// `check-all.mjs` (so `--adopt-gate-spine` is the thing that actually rewrites
// it under `--only`). AC-2664.1: `--only` resolves the dependency closure of
// the adopted spine file, or refuses naming the gap.
//
// Review follow-ups (P1/P2 below): AC-2664.2 (`--adopt-plan` shows the
// closure, including a dependency with no prior manifest baseline) and the
// same failure mode under plain `--adopt` (not only `--adopt-gate-spine`).
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

/** Every `./lib/<name>.mjs` import named in `scripts/check-all.mjs`'s source. */
function libImportsOf(dir: string): string[] {
  const source = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
  return [...source.matchAll(/from ['"]\.\/lib\/([^'"]+\.mjs)['"]/g)].map((m) => m[1] as string)
}

describe('#2664 update --adopt-gate-spine --only scripts/check-all.mjs — lib dependency closure', () => {
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

  it('emits every scripts/lib/*.mjs the adopted spine imports, not just check-all.mjs itself', async () => {
    await initProject(dir)

    // Simulate a project whose lib dir predates a newer spine import, and a
    // user-modified check-all.mjs (so `--adopt-gate-spine` is required to force
    // the rewrite under `--only`, matching the real #2664 repro).
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
    )

    await runUpdate({
      dir,
      json: true,
      github: false,
      adoptGateSpine: true,
      only: ['scripts/check-all.mjs'],
    })

    const imports = libImportsOf(dir)
    expect(imports.length).toBeGreaterThan(0)
    for (const name of imports) {
      expect(existsSync(join(dir, 'scripts', 'lib', name))).toBe(true)
    }
  }, 60_000)

  it('plain --adopt (not --adopt-gate-spine) also resolves the closure under --only', async () => {
    await initProject(dir)
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
    )

    // #2119's `adoptAll` force-adopts the gate spine exactly like
    // --adopt-gate-spine (buildAdoptPredicate) — same dangling-import failure
    // mode under a scoped --only.
    await runUpdate({
      dir,
      json: true,
      github: false,
      adopt: true,
      only: ['scripts/check-all.mjs'],
    })

    const imports = libImportsOf(dir)
    expect(imports.length).toBeGreaterThan(0)
    for (const name of imports) {
      expect(existsSync(join(dir, 'scripts', 'lib', name))).toBe(true)
    }
  }, 60_000)

  it('--adopt-plan names a gate-spine dependency it would CREATE (no prior manifest baseline)', async () => {
    await initProject(dir)
    // Simulate an OLDER project that never had this lib module emitted at all
    // (not merely deleted): no baseline in the manifest, and absent from disk.
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    const manifest = loadGeneratedManifest(dir)
    delete manifest['scripts/lib/gate-mutex.mjs']
    saveGeneratedManifest(dir, manifest)
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
    )

    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
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
      spy.mockRestore()
    }
    const payload = JSON.parse(out.join('')) as {
      data: { wouldCreateGateSpineDependencies: string[] }
    }
    expect(payload.data.wouldCreateGateSpineDependencies).toContain('scripts/lib/gate-mutex.mjs')
    // Read-only: --adopt-plan must not have written the file it is reporting on.
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(false)
  }, 60_000)
})
