// SPDX-License-Identifier: Apache-2.0
// #2089 — the stale-dist guard shared by check-self-dogfood.mjs and
// check-codex-self-parity.mjs. Originally (#1984) it compared filesystem
// mtimes: the newest mtime under the watched src/ subtrees vs the newest under
// dist/. That is fragile in two directly-observed ways:
//   1. CI cache-restore skew — `git checkout` resets every src/ mtime to
//      checkout time while an actions/cache-restored dist/ keeps its older
//      cache mtime, so a cache HIT makes every src/ file look newer than dist/
//      regardless of content (false-positive stale, independent of the PR).
//   2. Local edit-then-verify skew — any Edit/Write bumps a src/ file's mtime
//      to now, newer than a dist/ built moments earlier, even when the write
//      changed no bytes (touch / same-content rewrite) → false-positive stale.
// checkDistFresh() now compares a CONTENT hash of the watched src/ files
// against the hash writeDistManifest() stored inside dist/ at build time, so
// neither mtime skew can false-positive it. It still fails closed (stale) when
// dist/ or its manifest is missing, and — correctly — when the watched src/
// content genuinely differs from what dist/ was built from.
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
// Import the real .mjs SSOT (not a re-implementation) so the test guards the shipped file.
const mod = (await import(join(REPO_ROOT, 'scripts/lib/dist-staleness.mjs'))) as {
  checkDistFresh: (
    root: string,
    opts?: { srcDirs?: string[] },
  ) => { fresh: boolean; reason?: string }
  writeDistManifest: (root: string, opts?: { srcDirs?: string[] }) => string
  DEFAULT_WATCHED_SRC_DIRS: string[]
}
const { checkDistFresh, writeDistManifest } = mod

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dist-staleness-'))
  created.push(dir)
  return dir
}

/**
 * Independently recompute the content hash the module stores/compares, mirroring
 * scripts/lib/dist-staleness.mjs#computeWatchedSrcHash: sha256 over the
 * repo-root-relative POSIX path + NUL + content + NUL of each watched file,
 * ordered by path. Duplicated on purpose so a manifest fixture can be written
 * DIRECTLY (not via writeDistManifest) — this makes the mode-1/mode-2
 * regressions a clean behavioural RED against the old mtime code, and guards the
 * shipped hashing algorithm from silent drift.
 */
function hashOf(files: Array<[string, string]>): string {
  const h = createHash('sha256')
  for (const [relKey, content] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    h.update(relKey)
    h.update('\0')
    h.update(Buffer.from(content))
    h.update('\0')
  }
  return h.digest('hex')
}

/** Write a manifest fixture directly (bypassing writeDistManifest) at dist/.src-manifest.json. */
function writeManifest(root: string, srcHash: string) {
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', '.src-manifest.json'), `${JSON.stringify({ srcHash })}\n`)
}

/** Build a minimal { src/generators/codex.ts, dist/generators/codex.js } tree. */
function buildTree(root: string, srcContent = 'export const x = 1') {
  mkdirSync(join(root, 'src', 'generators'), { recursive: true })
  mkdirSync(join(root, 'dist', 'generators'), { recursive: true })
  writeFileSync(join(root, 'src', 'generators', 'codex.ts'), srcContent)
  writeFileSync(join(root, 'dist', 'generators', 'codex.js'), 'export const x = 1')
}

describe('checkDistFresh (#2089 content-hash)', () => {
  it('reports FRESH when the stored manifest hash matches current watched src content', () => {
    const root = tmpRoot()
    buildTree(root)
    writeManifest(root, hashOf([['src/generators/codex.ts', 'export const x = 1']]))

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })

  // ── mode 1: CI cache-restore skew ──────────────────────────────────────────
  // dist/ (restored from cache) is OLDER than src/ (mtimes reset by checkout),
  // but the content is identical — the old mtime code false-positived stale;
  // content-hash must report FRESH.
  it('reports FRESH when dist/ mtime is older than src/ but content matches (cache-restore skew)', () => {
    const root = tmpRoot()
    buildTree(root)
    writeManifest(root, hashOf([['src/generators/codex.ts', 'export const x = 1']]))
    const past = new Date(Date.now() - 600_000)
    const now = new Date()
    utimesSync(join(root, 'dist', 'generators', 'codex.js'), past, past) // restored: old
    utimesSync(join(root, 'src', 'generators', 'codex.ts'), now, now) // checkout: now

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })

  // ── mode 2: local edit-then-verify skew ────────────────────────────────────
  // A watched src/ file's mtime is bumped to now (touch / same-content rewrite)
  // while its bytes are unchanged — content-hash must report FRESH.
  it('reports FRESH when a watched src file is touched to now but its bytes are unchanged', () => {
    const root = tmpRoot()
    buildTree(root)
    writeManifest(root, hashOf([['src/generators/codex.ts', 'export const x = 1']]))
    const now = new Date()
    utimesSync(join(root, 'src', 'generators', 'codex.ts'), now, now) // mtime bump only

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })

  // ── the guard still does its job: genuine content change ───────────────────
  it('reports STALE when watched src content genuinely differs from the manifest', () => {
    const root = tmpRoot()
    buildTree(root, 'export const x = 2') // src now differs from what the manifest recorded
    writeManifest(root, hashOf([['src/generators/codex.ts', 'export const x = 1']]))

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(false)
    expect(result.reason).toMatch(/npm run build/)
  })

  it('reports STALE (fail-closed) when dist/ does not exist at all', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'src', 'generators'), { recursive: true })
    writeFileSync(join(root, 'src', 'generators', 'codex.ts'), 'export const x = 1')

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(false)
    expect(result.reason).toMatch(/npm run build/)
  })

  it('reports STALE (fail-closed) when dist/ exists but the manifest is missing', () => {
    const root = tmpRoot()
    buildTree(root) // dist/ present, but no manifest written

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(false)
    expect(result.reason).toMatch(/npm run build/)
  })

  it('only hashes the declared srcDirs, ignoring untouched src/ subtrees', () => {
    const root = tmpRoot()
    buildTree(root)
    writeManifest(root, hashOf([['src/generators/codex.ts', 'export const x = 1']]))
    // An unrelated src subtree changes, but it is NOT in srcDirs — must stay FRESH.
    mkdirSync(join(root, 'src', 'unrelated'), { recursive: true })
    writeFileSync(join(root, 'src', 'unrelated', 'notes.ts'), 'export const y = 99')

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })
})

describe('writeDistManifest (#2089) round-trips with checkDistFresh', () => {
  it('writes a manifest that checkDistFresh then accepts as FRESH', () => {
    const root = tmpRoot()
    buildTree(root)

    const hash = writeDistManifest(root, { srcDirs: ['src/generators'] })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(checkDistFresh(root, { srcDirs: ['src/generators'] }).fresh).toBe(true)
  })

  it('a manifest written before a src content change is then detected STALE', () => {
    const root = tmpRoot()
    buildTree(root)
    writeDistManifest(root, { srcDirs: ['src/generators'] })

    writeFileSync(join(root, 'src', 'generators', 'codex.ts'), 'export const x = 3')
    expect(checkDistFresh(root, { srcDirs: ['src/generators'] }).fresh).toBe(false)
  })
})
