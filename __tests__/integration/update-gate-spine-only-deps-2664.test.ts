// SPDX-License-Identifier: Apache-2.0
// #2664: `update --adopt-gate-spine --only scripts/check-all.mjs` must not land
// a spine that imports a `./lib/*.mjs` module it did not also emit. Repro: a
// project whose `scripts/lib/gate-mutex.mjs` predates the spine's import of it
// (deleted here to simulate the stale lib dir) plus a user-modified
// `check-all.mjs` (so `--adopt-gate-spine` is the thing that actually rewrites
// it under `--only`). AC-2664.1: `--only` resolves the dependency closure of
// the adopted spine file, or refuses naming the gap.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'

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
})
