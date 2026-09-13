// SPDX-License-Identifier: Apache-2.0
// #2664 (P3, review follow-up): an `--only scripts/check-all.mjs
// --adopt-gate-spine` run whose spine imports a `./lib/x.mjs` module with no
// matching template must refuse before any managed-file write — not just name
// the gap eventually. `gateSpineDependencies` is mocked to force the
// `unresolved` branch (every REAL template today resolves, so this path is
// otherwise unreachable without a genuine template/import drift). Isolated in
// its own file because `vi.mock` is module-wide and would break the sibling
// suite's real-import assertions.
//
// Round 2, finding 4 (orchestrator decision: keep the lock-then-read
// ordering — `.arbiter/` dir-ensure and the advisory lock are idempotent
// infrastructure, not project-managed content, so they stay ahead of the
// refusal): a targeted before/after diff of 3 files is not strong enough
// evidence for that claim on its own, so this test snapshots the ENTIRE
// project tree (relative path -> sha256, excluding `.arbiter/.lock` itself,
// whose own release-on-throw lifecycle the snapshot is not testing) and
// asserts it is byte-for-byte unchanged across the refused run.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'

/**
 * Every file under `dir` (recursive), as a relative-posix-path -> sha256 map,
 * excluding `.arbiter/.lock` — the one path this refusal's own lock lifecycle
 * legitimately creates and removes (`acquireLock`/`release`), which is not
 * project-managed content and not what this snapshot is asserting about.
 */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name)
      const rel = relative(dir, abs).split('\\').join('/')
      if (rel === '.arbiter/.lock') continue
      if (entry.isDirectory()) {
        walk(abs)
      } else if (statSync(abs).isFile()) {
        out[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex')
      }
    }
  }
  walk(dir)
  return out
}

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
    const beforeTree = snapshotTree(dir)

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
    // Whole-tree proof (round 2, finding 4): only `.arbiter/` dir-ensure and
    // the advisory lock (excluded above) precede the refusal — nothing else
    // in the project, managed or not, changed.
    expect(snapshotTree(dir)).toEqual(beforeTree)
    rmSync(join(dir, '.arbiter', '.lock'), { force: true })
  }, 60_000)
})
