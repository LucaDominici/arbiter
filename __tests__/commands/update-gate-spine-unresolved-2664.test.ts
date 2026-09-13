// SPDX-License-Identifier: Apache-2.0
// #2664: unit coverage for `widenOnlyForGateSpineDeps`'s `unresolved.length >
// 0` throw (src/commands/update.ts). `gateSpineDependencies` (a collaborator
// of update.ts, not the module under test) is mocked to force the branch —
// every REAL template resolves today, so this path is otherwise unreachable
// without a genuine template/import drift. Isolated in its own file because
// `vi.mock` is module-wide and would break the sibling suite's real-import
// scenarios.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
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

describe('#2664 unit coverage: widenOnlyForGateSpineDeps unresolved-import throw', () => {
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

  it('throws naming the unresolved lib module', async () => {
    await initProject(dir)
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
    expect(existsSync(join(dir, 'scripts', 'lib', 'does-not-exist.mjs'))).toBe(false)
  }, 60_000)
})
