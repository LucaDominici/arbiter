// SPDX-License-Identifier: Apache-2.0
// #2763: build-kernel-plugin.mjs only ever overwrote its current outputs, so after an emitted
// file was removed or renamed `npm run regen` left check-kernel-plugin-parity.mjs red until
// someone deleted the stale file by hand. The writer now records what it emits in a manifest
// inside its output root (scripts/lib/kernel-manifest.mjs) and prunes exactly the entries that
// dropped out of it.
//
// Decision: the prune is scoped to the MANIFEST, not to "everything in the root". A hand-added
// foreign file was never in the manifest, so it survives and the parity gate keeps rejecting it
// (CANON-25) instead of a regen silently turning the tree green by deleting unknown files.
//
// This suite drives the helper directly and needs no dist/: the TDD replay re-runs it in a
// detached checkout that has no build output, and the RED evidence must be identical there.
// The end-to-end build + parity proof lives in build-kernel-plugin-prune.test.ts.
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const libPath = resolve(__dirname, '..', '..', 'scripts', 'lib', 'kernel-manifest.mjs')
const load = async () => import(libPath)

let scratch: string | undefined

function seed(root: string, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body)
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

/** An empty output root inside a scratch dir (whose parent is where an escape would land). */
function fresh() {
  scratch = mkdtempSync(join(tmpdir(), 'kernel-manifest-'))
  const dir = join(scratch, 'hooks')
  mkdirSync(dir)
  return dir
}

describe('kernel-manifest syncManifest (#2763)', () => {
  it('removes a file the previous manifest listed but the writer no longer emits', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    seed(dir, { 'old-name.mjs': 'x', 'kept.mjs': 'y' })
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ files: ['kept.mjs', 'old-name.mjs'] }))

    const pruned = syncManifest(dir, ['kept.mjs', 'new-name.mjs'])

    expect(pruned).toEqual(['old-name.mjs'])
    expect(existsSync(join(dir, 'old-name.mjs'))).toBe(false)
    expect(existsSync(join(dir, 'kept.mjs'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, MANIFEST), 'utf-8')).files).toEqual([
      'kept.mjs',
      'new-name.mjs',
    ])
  })

  it('leaves a hand-added foreign file alone (parity keeps rejecting it, CANON-25)', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    seed(dir, { 'foreign.mjs': 'hand-added' })
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ files: [] }))

    expect(syncManifest(dir, ['kept.mjs'])).toEqual([])
    expect(readFileSync(join(dir, 'foreign.mjs'), 'utf-8')).toBe('hand-added')
  })

  it('treats an absent manifest as a first build: nothing is pruned', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    seed(dir, { 'existing.mjs': 'z' })

    expect(syncManifest(dir, ['kept.mjs'])).toEqual([])
    expect(existsSync(join(dir, 'existing.mjs'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, MANIFEST), 'utf-8')).files).toEqual(['kept.mjs'])
  })

  it('refuses a manifest entry that is not a plain file name, deleting nothing outside the root', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    const victim = join(dirname(dir), 'victim.txt')
    writeFileSync(victim, 'keep me')
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ files: ['../victim.txt'] }))

    expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/not a plain file name/)
    expect(readFileSync(victim, 'utf-8')).toBe('keep me')
  })
})
