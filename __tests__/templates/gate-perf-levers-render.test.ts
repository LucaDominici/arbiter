// SPDX-License-Identifier: Apache-2.0
// CANON-04 render tests for the #2104 gate levers, ported from the measurements taken in a
// downstream governed project (see #2104 for the source commits):
//
//   A. resolveTmpfsTmpdir — TMPDIR on tmpfs, guarded by FREE SPACE, never by existence.
//   B. the Go `coverage profile` step must NOT pin -covermode=atomic (debt-lib re-runs the
//      same suite with the default covermode, and covermode partitions Go's test cache).
//   C. walkRepo must prune nested checkouts (git worktree / submodule / vendored clone).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

type StatFs = { bavail: number; bsize: number }
type RunHelpers = {
  resolveTmpfsTmpdir: (opts?: {
    path?: string
    minFreeBytes?: number
    statfs?: (p: string) => StatFs
  }) => string | null
}
type GlobWalk = { walkRepo: (root: string) => string[] }

const dirs: string[] = []
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let runHelpers: RunHelpers
let globWalk: GlobWalk
beforeAll(async () => {
  // Import the RENDERED templates (not a re-implementation) so the test guards what a
  // governed project actually receives.
  const dir = tmpDir('gate-perf-levers-')
  const helpers = join(dir, 'run-helpers.mjs')
  writeFileSync(helpers, render('scripts/lib/run-helpers.mjs.ejs'))
  runHelpers = (await import(pathToFileURL(helpers).href)) as unknown as RunHelpers
  const walker = join(dir, 'glob-walk.mjs')
  writeFileSync(walker, render('scripts/lib/glob-walk.mjs.ejs'))
  globWalk = (await import(pathToFileURL(walker).href)) as unknown as GlobWalk
})

const GIB = 1024 ** 3

describe('run-helpers.mjs.ejs — resolveTmpfsTmpdir free-space guard (#2104)', () => {
  it('returns the tmpfs path when free space clears the floor', () => {
    // 8 Mi blocks x 4 KiB = 32 GiB available.
    expect(
      runHelpers.resolveTmpfsTmpdir({ statfs: () => ({ bavail: 8 * 1024 * 1024, bsize: 4096 }) }),
    ).toBe('/dev/shm')
  })

  it('returns null for a container-default 64 MB /dev/shm — existence is NOT the guard', () => {
    // /dev/shm exists in every Linux container but defaults to 64 MB there, and TMPDIR
    // relocates more than t.TempDir(): GOTMPDIR is unset, so Go's build work dirs and test
    // binaries land there too. An existsSync guard would ENOSPC every containerised runner
    // while staying green locally — the exact failure this floor exists to prevent.
    expect(
      runHelpers.resolveTmpfsTmpdir({ statfs: () => ({ bavail: 16384, bsize: 4096 }) }),
    ).toBeNull()
  })

  it('returns null when statfs throws (absent, unmounted, or non-Linux)', () => {
    expect(
      runHelpers.resolveTmpfsTmpdir({
        statfs: () => {
          throw new Error('ENOENT: no such file or directory')
        },
      }),
    ).toBeNull()
  })

  it('honours an injected path and floor', () => {
    expect(
      runHelpers.resolveTmpfsTmpdir({
        path: '/run/shm',
        minFreeBytes: GIB,
        statfs: () => ({ bavail: 2 * 1024 * 1024, bsize: 1024 }),
      }),
    ).toBe('/run/shm')
  })
})

describe('check-all.mjs.ejs — TMPDIR is set before the first child spawn (#2104)', () => {
  // #2041: check-all.mjs.ejs is registry-driven — render through the shared helper.
  const gate = () =>
    renderCheckAll(
      makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L1',
      }) as unknown as Record<string, unknown>,
    )

  it('resolves the tmpfs TMPDIR only when the caller has not already set one', () => {
    const out = gate()
    expect(out).toContain('resolveTmpfsTmpdir')
    expect(out).toMatch(/if \(!process\.env\.TMPDIR\)/)
    expect(out).toMatch(/process\.env\.TMPDIR = /)
  })

  it('assigns TMPDIR ahead of the first runCheck — a later assignment is inherited by nothing', () => {
    const out = gate()
    const assign = out.indexOf('process.env.TMPDIR =')
    const firstSpawn = out.indexOf('runCheck(')
    expect(assign).toBeGreaterThan(-1)
    expect(firstSpawn).toBeGreaterThan(-1)
    expect(assign).toBeLessThan(firstSpawn)
  })
})

describe('check-all.mjs.ejs — Go coverage profile keeps the default covermode (#2104)', () => {
  const goCfg = {
    language: 'go',
    governanceLevel: 'L2',
    enableDebtGates: true,
    coverageEnabled: true,
    coverageThreshold: 80,
  }

  // #2041: registry-driven — render through the shared helper with a full makeConfig base.
  const renderGoGate = () =>
    renderCheckAll(
      makeConfig('/tmp/test', goCfg as never) as unknown as Record<string, unknown>,
    )

  it('still emits the coverage profile step', () => {
    expect(renderGoGate()).toContain("runCheck('coverage profile'")
  })

  it('does not pin -covermode=atomic', () => {
    // covermode partitions Go's test cache. debt-lib.mjs re-runs the WHOLE suite in the same
    // gate with the default covermode, so pinning `atomic` here forced a full second pass:
    // 231.4s measured in a governed project, 0.77s (52/52 cached) once aligned. Statement
    // coverage is identical between the modes; atomic counters are only required under -race,
    // a separate step that collects no coverage. `set` can only ever under-report, and the
    // threshold is a floor — the fail-safe direction.
    expect(renderGoGate()).not.toContain('-covermode=atomic')
  })

  it('debt-lib.mjs.ejs is the alignment target and stays on the default covermode', () => {
    const debt = render('scripts/debt-lib.mjs.ejs', goCfg)
    expect(debt).toContain("'-coverprofile=.coverage-tmp.out'")
    expect(debt).not.toContain('-covermode')
  })
})

describe('glob-walk.mjs.ejs — walkRepo prunes nested checkouts (#2104)', () => {
  function nestedWorktreeFixture(): string {
    const root = tmpDir('glob-walk-tpl-')
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'own.go'), 'package own\n')
    // A git worktree nested inside the working tree: its own checkout at its own commit.
    // A worktree's `.git` is a FILE pointing at the shared gitdir, not a directory.
    const nested = join(root, 'worktrees', 'other-branch')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, '.git'), 'gitdir: /elsewhere/.git/worktrees/other-branch\n')
    writeFileSync(join(nested, 'theirs.go'), 'package theirs\n')
    return root
  }

  it("walks the repo's own files — the root carries .git too and stays exempt", () => {
    expect(globWalk.walkRepo(nestedWorktreeFixture())).toContain('own.go')
  })

  it('does not descend into a nested worktree', () => {
    // Folding another branch's files in makes every consumer lie: this is what made a
    // governed project's debt ratchet count a deferred-work marker belonging to another
    // branch and fail the gate on main, and made the secret scan re-scan each worktree's
    // copy of the whole tree (62,974 files -> 20,528).
    const files = globWalk.walkRepo(nestedWorktreeFixture())
    expect(files.filter((f) => f.includes('theirs.go'))).toEqual([])
  })

  it('prunes a submodule / vendored clone whose .git is a DIRECTORY', () => {
    const root = tmpDir('glob-walk-tpl-sub-')
    mkdirSync(join(root, 'vendor', 'dep', '.git'), { recursive: true })
    writeFileSync(join(root, 'vendor', 'dep', 'theirs.go'), 'package theirs\n')
    writeFileSync(join(root, 'own.go'), 'package own\n')
    const files = globWalk.walkRepo(root)
    expect(files).toContain('own.go')
    expect(files.filter((f) => f.includes('theirs.go'))).toEqual([])
  })

  it('still walks a plain deep directory that merely looks nested', () => {
    const root = tmpDir('glob-walk-tpl-plain-')
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'pkg', 'sub'), { recursive: true })
    writeFileSync(join(root, 'pkg', 'sub', 'deep.go'), 'package sub\n')
    expect(globWalk.walkRepo(root)).toContain('pkg/sub/deep.go')
  })
})
