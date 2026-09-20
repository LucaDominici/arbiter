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
// Fail-closed (independent review of #2777): every manifest entry is validated before ANY
// deletion, a symlinked output root / manifest is refused, and a missing or malformed previous
// manifest prunes nothing and fails with a named reason.
//
// Nearly everything here drives the helper directly and needs no dist/: the TDD replay re-runs
// this file in a detached checkout that has no build output, and the RED evidence must be
// identical there. The one build-ordering case spawns the writer, so it fails in both places at
// RED and passes wherever dist/ exists. The end-to-end build + parity proof lives in
// build-kernel-plugin-prune.test.ts.
import { describe, it, expect, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
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

  it('treats an absent manifest in an empty root as a first build', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()

    expect(syncManifest(dir, ['kept.mjs'])).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, MANIFEST), 'utf-8')).files).toEqual(['kept.mjs'])
  })

  it('fails with a named reason, pruning nothing, when the manifest is missing from a populated root', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    seed(dir, { 'existing.mjs': 'z' })

    expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/manifest is missing/)
    expect(existsSync(join(dir, 'existing.mjs'))).toBe(true)
    expect(existsSync(join(dir, MANIFEST))).toBe(false)
  })

  it.each([
    ['unparseable JSON', '{not json'],
    ['a bare array', '[]'],
    ['files that is not an array', '{"files":"old.mjs"}'],
    ['no files key', '{}'],
  ])(
    'fails with a named reason, pruning nothing, on a malformed manifest (%s)',
    async (_n, body) => {
      const { syncManifest, MANIFEST } = await load()
      const dir = fresh()
      seed(dir, { 'old.mjs': 'x' })
      writeFileSync(join(dir, MANIFEST), body)

      expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/manifest is malformed/)
      expect(existsSync(join(dir, 'old.mjs'))).toBe(true)
      expect(readFileSync(join(dir, MANIFEST), 'utf-8')).toBe(body)
    },
  )

  it.each([
    ['an empty string', ''],
    ['a NUL byte', 'bad\0name.mjs'],
    ['an absolute path', '/etc/hosts'],
    ['a dot', '.'],
    ['a parent dir', '..'],
    ['a nested path', 'sub/old.mjs'],
    ['a non-string', 42],
  ])(
    'validates every entry before deleting any: %s aborts with old.mjs intact',
    async (_n, bad) => {
      const { syncManifest, MANIFEST } = await load()
      const dir = fresh()
      seed(dir, { 'old.mjs': 'x' })
      const before = JSON.stringify({ files: ['old.mjs', bad] })
      writeFileSync(join(dir, MANIFEST), before)

      expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/not a plain file name/)
      expect(existsSync(join(dir, 'old.mjs'))).toBe(true)
      expect(readFileSync(join(dir, MANIFEST), 'utf-8')).toBe(before)
    },
  )

  it('refuses a manifest entry that names a directory, before deleting anything', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    seed(dir, { 'old.mjs': 'x' })
    mkdirSync(join(dir, 'subdir'))
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ files: ['old.mjs', 'subdir'] }))

    expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/not a regular file/)
    expect(existsSync(join(dir, 'old.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'subdir'))).toBe(true)
  })

  it('refuses a symlinked output root: the external file it points at survives', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    const external = join(dirname(dir), 'external')
    mkdirSync(external)
    writeFileSync(join(external, 'victim.txt'), 'keep me')
    writeFileSync(join(external, MANIFEST), JSON.stringify({ files: ['victim.txt'] }))
    const link = join(dirname(dir), 'link-root')
    symlinkSync(external, link, 'dir')

    expect(() => syncManifest(link, ['kept.mjs'])).toThrow(/symlink/)
    expect(readFileSync(join(external, 'victim.txt'), 'utf-8')).toBe('keep me')
  })

  it('refuses a symlinked manifest so the new manifest is never written through it', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    const target = join(dirname(dir), 'elsewhere.json')
    writeFileSync(target, JSON.stringify({ files: [] }))
    symlinkSync(target, join(dir, MANIFEST))

    expect(() => syncManifest(dir, ['kept.mjs'])).toThrow(/symlink/)
    expect(readFileSync(target, 'utf-8')).toBe(JSON.stringify({ files: [] }))
  })

  it('removes a listed symlink entry itself and never the file it points at', async () => {
    const { syncManifest, MANIFEST } = await load()
    const dir = fresh()
    const target = join(dirname(dir), 'outside.txt')
    writeFileSync(target, 'keep me')
    symlinkSync(target, join(dir, 'old.mjs'))
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ files: ['old.mjs'] }))

    expect(syncManifest(dir, ['kept.mjs'])).toEqual(['old.mjs'])
    expect(readFileSync(target, 'utf-8')).toBe('keep me')
  })

  it('prunes a stale hook that imports a removed dependency instead of aborting the build first', () => {
    // Needs dist/ (spawns the writer). Before the fix shipVerifierImports scanned the stale
    // file's dead import and threw before the prune ever ran.
    const out = join(fresh(), 'build-out')
    const build = resolve(__dirname, '..', '..', 'scripts', 'build-kernel-plugin.mjs')
    const first = spawnSync('node', [build, `--out=${out}`], { encoding: 'utf-8' })
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0)
    const manifestPath = join(out, '.kernel-build-manifest.json')
    const files: string[] = JSON.parse(readFileSync(manifestPath, 'utf-8')).files
    writeFileSync(manifestPath, JSON.stringify({ files: [...files, 'stale.mjs'] }))
    writeFileSync(join(out, 'stale.mjs'), "import { gone } from './removed-dependency.mjs'\n")

    const second = spawnSync('node', [build, `--out=${out}`], { encoding: 'utf-8' })

    expect(second.status, `${second.stdout}${second.stderr}`).toBe(0)
    expect(existsSync(join(out, 'stale.mjs'))).toBe(false)
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

// Second review round of #2777: `lstat('link/')` follows the link, so a root written with a
// trailing separator slipped past the symlink refusal and the prune ran in the external
// target. Both exported entry points normalize the root once, before any check.
describe('symlinked output root is refused however it is spelled (#2763)', () => {
  const buildPath = resolve(__dirname, '..', '..', 'scripts', 'build-kernel-plugin.mjs')

  /** An external dir holding a victim the manifest names, and a symlink to it. */
  function linkedRoot() {
    const dir = fresh()
    const external = join(dirname(dir), 'external')
    mkdirSync(external)
    writeFileSync(join(external, 'victim.txt'), 'keep me')
    writeFileSync(join(external, '.kernel-build-manifest.json'), '{"files":["victim.txt"]}')
    const link = join(dirname(dir), 'link-root')
    symlinkSync(external, link, 'dir')
    const snapshot = () =>
      readdirSync(external)
        .sort()
        .map((n) => [n, readFileSync(join(external, n), 'utf-8')])
    return { link, snapshot, before: snapshot() }
  }

  it.each([
    ['link', (l: string) => l],
    ['link/', (l: string) => `${l}/`],
    ['link//', (l: string) => `${l}//`],
    ['link/.', (l: string) => `${l}/.`],
  ])(
    'syncManifest(%s) fails naming the symlink and leaves the target untouched',
    async (_n, spell) => {
      const { syncManifest } = await load()
      const { link, snapshot, before } = linkedRoot()

      expect(() => syncManifest(spell(link), ['kept.mjs'])).toThrow(/output root .* is a symlink/)
      expect(snapshot()).toEqual(before)
    },
  )

  it.each([
    ['link', (l: string) => l],
    ['link/', (l: string) => `${l}/`],
    ['link//', (l: string) => `${l}//`],
  ])(
    'buildKernelPlugin(%s) fails naming the symlink and deletes/writes nothing in the target',
    async (_n, spell) => {
      const { buildKernelPlugin } = await import(buildPath)
      const { link, snapshot, before } = linkedRoot()

      expect(() => buildKernelPlugin(spell(link))).toThrow(/output root .* is a symlink/)
      expect(snapshot()).toEqual(before)
    },
  )
})
