// SPDX-License-Identifier: Apache-2.0
// #2664 (P3, review follow-up): an `--only scripts/check-all.mjs
// --adopt-gate-spine` run whose spine imports a `./lib/x.mjs` module with no
// matching template must refuse before any managed-file write — not just name
// the gap eventually. `gateSpineDependencies` is mocked to force the
// `unresolved` branch (every REAL template today resolves, so this path is
// otherwise unreachable without a genuine template/import drift). Isolated in
// its own file because `vi.mock` is module-wide and would break the sibling
// suite's real-import assertions.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'

vi.mock('../../src/generators/check-all.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/generators/check-all.js')>()
  return {
    ...actual,
    gateSpineDependencies: () => ({
      resolved: [],
      unresolved: ['scripts/lib/does-not-exist.mjs'],
    }),
  }
})

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

describe('#2664 update --adopt-gate-spine --only — refuses on an unresolved lib import', () => {
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

  it('throws naming the gap, before touching arbiter.json, the manifest, or scripts/lib/', async () => {
    await initProject(dir)
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      `// locally customized\n${readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')}`,
    )
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    const beforeManifest = readFileSync(join(dir, '.arbiter-generated-manifest.json'), 'utf-8')

    const { runUpdate } = await import('../../src/commands/update.js')
    await expect(
      runUpdate({
        dir,
        json: true,
        github: false,
        adoptGateSpine: true,
        only: ['scripts/check-all.mjs'],
      }),
    ).rejects.toThrow(/does-not-exist\.mjs/)

    expect(readFileSync(join(dir, 'arbiter.json'), 'utf-8')).toBe(before)
    expect(readFileSync(join(dir, '.arbiter-generated-manifest.json'), 'utf-8')).toBe(
      beforeManifest,
    )
    expect(existsSync(join(dir, 'scripts', 'lib', 'does-not-exist.mjs'))).toBe(false)
    rmSync(join(dir, '.arbiter', '.lock'), { force: true })
  }, 60_000)
})
