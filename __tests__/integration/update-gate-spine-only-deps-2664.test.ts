// SPDX-License-Identifier: Apache-2.0
// #2664: `update --adopt-gate-spine --only scripts/check-all.mjs` must not land
// a spine that imports a `./lib/*.mjs` module it did not also emit. Repro: a
// project whose `scripts/lib/gate-mutex.mjs` predates the spine's import of it
// (deleted here to simulate the stale lib dir) plus a user-modified
// `check-all.mjs` (so `--adopt-gate-spine` is the thing that actually rewrites
// it under `--only`). AC-2664.1: `--only` resolves the dependency closure of
// the adopted spine file, or refuses naming the gap.
//
// Round-1 review follow-ups (P1/P2): AC-2664.2 (`--adopt-plan` shows the
// closure, including a dependency with no prior manifest baseline) and the
// same failure mode under plain `--adopt` (not only `--adopt-gate-spine`).
//
// Round-2 review follow-ups:
//   1. `gate-evidence.mjs` is imported DYNAMICALLY twice in the spine template
//      (`await import('./lib/gate-evidence.mjs')`) — a static-only `from`
//      regex misses it. `expectedLibImportsOf` below is an INDEPENDENT oracle
//      (a bare `lib/<name>.mjs` substring scan, no "import" keyword at all) so
//      the test cannot pass by re-running the same regex the fix uses.
//   2. a missing dependency EXCLUDED by `.arbiterignore` must refuse, not be
//      silently widened-then-deselected (ignore wins over `--only`).
//   3. `--adopt-plan` must name a dependency as "would create" even when a
//      WIDER `--only` (e.g. `scripts/**`) already covers it without widening.
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

/**
 * Every `lib/<name>.mjs` substring anywhere in `scripts/check-all.mjs`'s
 * source — deliberately NOT the production `LIB_IMPORT_PATTERN` (no "import"/
 * "from" keyword requirement at all), so this oracle cannot pass merely
 * because it repeats the fix's own regex (#2664 round 2, finding 1).
 */
function expectedLibImportsOf(dir: string): string[] {
  const source = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
  return [...new Set([...source.matchAll(/lib\/([\w-]+\.mjs)/g)].map((m) => m[1] as string))]
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

    const imports = expectedLibImportsOf(dir)
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

    const imports = expectedLibImportsOf(dir)
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

  it('round 2, finding 1: emits gate-evidence.mjs, which the spine imports DYNAMICALLY', async () => {
    await initProject(dir)
    // gate-evidence.mjs is reached only via `await import('./lib/gate-evidence.mjs')`
    // (check-all.mjs.ejs), never a static `from` import — the exact case the
    // original from-only regex missed.
    rmSync(join(dir, 'scripts', 'lib', 'gate-evidence.mjs'))
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

    expect(expectedLibImportsOf(dir)).toContain('gate-evidence.mjs')
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-evidence.mjs'))).toBe(true)
  }, 60_000)

  it('round 2, finding 2: refuses when a missing dependency is excluded by .arbiterignore', async () => {
    await initProject(dir)
    rmSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))
    writeFileSync(join(dir, '.arbiterignore'), 'scripts/lib/gate-mutex.mjs\n')
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
    )
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')

    // Ignore wins over --only at the write chokepoint (buildSelectionPredicate):
    // silently widening `only` here would just get silently deselected again,
    // landing the exact dangling-import spine this fix exists to prevent —
    // refuse instead, naming the ignored gap.
    await expect(
      runUpdate({
        dir,
        json: true,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
      }),
    ).rejects.toThrow(/gate-mutex\.mjs/)

    expect(readFileSync(join(dir, 'arbiter.json'), 'utf-8')).toBe(before)
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(false)
  }, 60_000)

  it('round 2, finding 3: --adopt-plan names a create even when a WIDER --only already covers it', async () => {
    await initProject(dir)
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
      // `scripts/**` already matches scripts/lib/gate-mutex.mjs — no widening
      // of `only` is needed for the real write to include it, but the plan
      // must still name it as a create (the deps set is the FULL closure, not
      // only the subset --only had to be widened with).
      await runUpdate({
        dir,
        json: true,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/**'],
        adoptPlan: true,
      })
    } finally {
      spy.mockRestore()
    }
    const payload = JSON.parse(out.join('')) as {
      data: { wouldCreateGateSpineDependencies: string[] }
    }
    expect(payload.data.wouldCreateGateSpineDependencies).toContain('scripts/lib/gate-mutex.mjs')
    expect(existsSync(join(dir, 'scripts', 'lib', 'gate-mutex.mjs'))).toBe(false)
  }, 60_000)
})
