// SPDX-License-Identifier: Apache-2.0
// #2763: build-kernel-plugin.mjs only ever overwrote its current outputs, so after an emitted
// file was removed or renamed `npm run regen` left check-kernel-plugin-parity.mjs red until
// someone deleted the stale file by hand. The writer now records what it emits in a manifest
// inside its output root and prunes exactly the entries that dropped out of it.
//
// Decision (documented in build-kernel-plugin.mjs): the prune is scoped to the manifest, NOT
// to "everything in the root". A hand-added foreign file was never in the manifest, so the
// build leaves it alone and the parity gate keeps rejecting it (CANON-25) instead of a regen
// silently making the tree green by deleting unknown files.
//
// The stale state is constructed unconditionally in setup (build, then forge the manifest
// entry + file a rename would have left behind), so the RED phase fails on the behaviour
// asserted, never on a setup read of a file that does not exist yet.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = resolve(__dirname, '..', '..')
const build = join(repoRoot, 'scripts', 'build-kernel-plugin.mjs')
const parity = join(repoRoot, 'scripts', 'check-kernel-plugin-parity.mjs')
const MANIFEST = '.kernel-build-manifest.json'

let scratch: string | undefined
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

function run(script: string, args: string[]) {
  const r = spawnSync('node', [script, ...args], { cwd: repoRoot, encoding: 'utf-8' })
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** A built output root whose manifest also lists `stale`, with that file on disk. */
function rootWithStale(stale: string): string {
  scratch = mkdtempSync(join(tmpdir(), 'kernel-prune-'))
  const out = join(scratch, 'hooks')
  expect(run(build, [`--out=${out}`]).status).toBe(0)
  const manifestPath = join(out, MANIFEST)
  const files: string[] = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8')).files
    : []
  writeFileSync(manifestPath, JSON.stringify({ files: [...files, stale] }))
  writeFileSync(join(out, stale), '// left behind by a rename\n')
  return out
}

describe('build-kernel-plugin.mjs prunes obsolete outputs (#2763)', () => {
  it('one build removes a file the manifest lists but the writer no longer emits', () => {
    const out = rootWithStale('renamed-away.mjs')

    expect(run(build, [`--out=${out}`]).status).toBe(0)

    expect(existsSync(join(out, 'renamed-away.mjs'))).toBe(false)
    const check = run(parity, ['--dir', out])
    expect(check.out).toContain('PASS')
    expect(check.status).toBe(0)
  })

  it('leaves a hand-added foreign file alone so parity still rejects it (CANON-25)', () => {
    const out = rootWithStale('renamed-away.mjs')
    writeFileSync(join(out, 'foreign.mjs'), '// hand-added\n')

    expect(run(build, [`--out=${out}`]).status).toBe(0)

    expect(existsSync(join(out, 'foreign.mjs'))).toBe(true)
    const check = run(parity, ['--dir', out])
    expect(check.status).toBe(1)
    expect(check.out).toContain('foreign.mjs')
  })

  it('never deletes outside the output root, whatever the manifest names', () => {
    scratch = mkdtempSync(join(tmpdir(), 'kernel-prune-'))
    const out = join(scratch, 'hooks')
    mkdirSync(out, { recursive: true })
    const victim = join(scratch, 'victim.txt')
    writeFileSync(victim, 'keep me')
    writeFileSync(join(out, MANIFEST), JSON.stringify({ files: ['../victim.txt'] }))

    const res = run(build, [`--out=${out}`])
    expect(res.status).not.toBe(0)
    expect(res.out).toContain('not a plain file name')

    expect(readFileSync(victim, 'utf-8')).toBe('keep me')
  })

  it('a second build over an unchanged root is a no-op (regen converges)', () => {
    // Exercise the actual convergence claim: start from a root that still carries a stale
    // entry (the same fixture the prune tests use), so the FIRST build here has real pruning
    // to do. A second build over the now-clean root must then change nothing further — same
    // manifest, same file set — proving the prune itself converges rather than re-pruning or
    // re-writing on every run.
    const out = rootWithStale('renamed-away.mjs')
    expect(run(build, [`--out=${out}`]).status).toBe(0)
    expect(existsSync(join(out, 'renamed-away.mjs'))).toBe(false)
    const filesAfterFirst = readdirSync(out).sort()
    const manifestAfterFirst = readFileSync(join(out, MANIFEST), 'utf-8')

    expect(run(build, [`--out=${out}`]).status).toBe(0)

    expect(readdirSync(out).sort()).toEqual(filesAfterFirst)
    expect(readFileSync(join(out, MANIFEST), 'utf-8')).toBe(manifestAfterFirst)
    expect(run(parity, ['--dir', out]).status).toBe(0)
  })
})
