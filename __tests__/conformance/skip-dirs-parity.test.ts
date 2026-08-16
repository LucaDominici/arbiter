// SPDX-License-Identifier: Apache-2.0
// SKIP_DIRS TS↔mjs parity (#1521).
//
// The conformance engine (src/conformance/shared.ts) and the presence-gate .mjs walker
// (scripts/lib/glob-walk.mjs) each define a SKIP_DIRS prune-set. They are the single source of
// truth for "which vendor/build trees a repo walk prunes". The #1521 revolution unified ~30
// hand-rolled walkers onto these two helpers; this gate locks the two skip-lists byte-identical so
// the policy can never silently re-diverge (the exact drift the duplication ratchet cannot see).
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, afterEach } from 'vitest'
import { SKIP_DIRS as TS_SKIP_DIRS, walkRepo as tsWalkRepo } from '../../src/conformance/shared.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
// Import the real shipped .mjs SSOT (not a re-implementation) so the gate guards the live file.
const { SKIP_DIRS: MJS_SKIP_DIRS, walkRepo: mjsWalkRepo } = (await import(
  join(REPO_ROOT, 'scripts/lib/glob-walk.mjs')
)) as { SKIP_DIRS: ReadonlySet<string>; walkRepo: (root: string) => string[] }

// The full intended prune set, mirroring src/templates/scripts/lib/glob-walk.mjs.ejs.
// The three Python entries came from #1840 F4 tranche-3 and never reached the self copies.
const PYTHON_PRUNES = ['.venv', 'venv', '__pycache__']
const VENDOR_PRUNES = ['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage']
const ALL_PRUNES = [...VENDOR_PRUNES, ...PYTHON_PRUNES]

const tmpRoots: string[] = []
afterEach(() => {
  for (const d of tmpRoots.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A tree with one file under every pruned dir plus one under an unpruned control dir. */
function plantPruneFixture(ext: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'skip-dirs-'))
  tmpRoots.push(root)
  const seed = (dir: string): void => {
    // Nested on purpose: a dependency's bundled tests live deep inside site-packages,
    // not at the prune root, so a shallow prune would still let them through.
    const d = join(root, dir, 'lib', 'site-packages', 'pkg')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, `bundled${ext}`), body)
  }
  for (const dir of ALL_PRUNES) seed(dir)
  seed('src') // control: NOT pruned, must still be walked
  return root
}

describe('SKIP_DIRS TS↔mjs parity (#1521)', () => {
  it('the conformance (TS) and presence-gate (mjs) skip-lists are byte-identical', () => {
    const ts = [...TS_SKIP_DIRS].sort()
    const mjs = [...MJS_SKIP_DIRS].sort()
    expect(ts).toEqual(mjs)
  })

  it('the unified skip-list prunes every vendor/build tree the revolution consolidated', () => {
    for (const dir of ALL_PRUNES) {
      expect(TS_SKIP_DIRS.has(dir)).toBe(true)
    }
  })
})

// ── #2286: the #1840-F4 Python prunes must reach BOTH engines ────────────────────────
//
// A Python fixture's dependency-closure venv lives INSIDE the project tree, and
// third-party packages ship their own test suites inside site-packages. Walking those as
// project code is a false positive with zero relationship to the project's own source.
// The emitted template has pruned them since #1840 F4 tranche-3 and the self copies'
// comments CLAIM to mirror it — they did not.

describe('Python dependency-closure prunes (#2286 / #1840 F4)', () => {
  it('the TS conformance engine walkRepo prunes .venv / venv / __pycache__', () => {
    const root = plantPruneFixture('.py', 'import x\n')
    const walked = tsWalkRepo(root)
    expect(walked).toContain('src/lib/site-packages/pkg/bundled.py')
    for (const dir of PYTHON_PRUNES) {
      expect(walked.filter((f) => f.startsWith(`${dir}/`))).toEqual([])
    }
  })

  it('the presence-gate mjs walker prunes .venv / venv / __pycache__', () => {
    const root = plantPruneFixture('.py', 'import x\n')
    const walked = mjsWalkRepo(root)
    expect(walked).toContain('src/lib/site-packages/pkg/bundled.py')
    for (const dir of PYTHON_PRUNES) {
      expect(walked.filter((f) => f.startsWith(`${dir}/`))).toEqual([])
    }
  })

  it("check-no-stub-redirects' own local skip set prunes them too", () => {
    // Driven through the CLI, never imported: the script ends in a bare
    // `process.exit(main())`, so an import would terminate the vitest runner.
    const root = plantPruneFixture(
      '.md',
      '# Moved\n\nThis page has moved to [there](./there.md).\n',
    )
    const r = spawnSync(
      'node',
      [join(REPO_ROOT, 'scripts/check-no-stub-redirects.mjs'), '--dir', root],
      { encoding: 'utf-8' },
    )
    const out = `${r.stdout}${r.stderr}`
    // The control stub IS a violation — proving the gate is actually looking.
    expect(out).toContain('src/lib/site-packages/pkg/bundled.md')
    for (const dir of PYTHON_PRUNES) {
      expect(out).not.toContain(`${dir}/lib/site-packages`)
    }
  })
})
