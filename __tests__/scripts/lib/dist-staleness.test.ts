// SPDX-License-Identifier: Apache-2.0
// TDD red-phase for #1984: shared stale-dist guard consumed by
// check-self-dogfood.mjs and check-codex-self-parity.mjs. Both gates import
// compiled JS from dist/ (scripts/ cannot import .ts directly, #1267) but
// previously only guarded against a MISSING build, not a STALE one (built
// before the current src/ changes). checkDistFresh() compares the newest
// mtime under the watched src/ subtrees against the newest mtime under
// dist/ and fails closed when dist predates src.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
// Import the real .mjs SSOT (not a re-implementation) so the test guards the shipped file.
const { checkDistFresh } = (await import(join(REPO_ROOT, 'scripts/lib/dist-staleness.mjs'))) as {
  checkDistFresh: (
    root: string,
    opts?: { srcDirs?: string[] },
  ) => { fresh: boolean; reason?: string }
}

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

/** Build a minimal { src/generators/*, dist/* } tree and return the root. */
function buildTree(root: string) {
  mkdirSync(join(root, 'src', 'generators'), { recursive: true })
  mkdirSync(join(root, 'dist', 'generators'), { recursive: true })
  writeFileSync(join(root, 'src', 'generators', 'codex.ts'), 'export const x = 1')
  writeFileSync(join(root, 'dist', 'generators', 'codex.js'), 'export const x = 1')
}

describe('checkDistFresh (#1984)', () => {
  it('reports FRESH when dist/ is newer than every watched src/ file', () => {
    const root = tmpRoot()
    buildTree(root)
    const past = new Date(Date.now() - 60_000)
    const now = new Date()
    utimesSync(join(root, 'src', 'generators', 'codex.ts'), past, past)
    utimesSync(join(root, 'dist', 'generators', 'codex.js'), now, now)

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })

  it('reports STALE when a watched src/ file is newer than every dist/ file', () => {
    const root = tmpRoot()
    buildTree(root)
    const past = new Date(Date.now() - 60_000)
    const now = new Date()
    utimesSync(join(root, 'dist', 'generators', 'codex.js'), past, past)
    utimesSync(join(root, 'src', 'generators', 'codex.ts'), now, now)

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

  it('only compares the declared srcDirs, ignoring untouched src/ subtrees', () => {
    const root = tmpRoot()
    buildTree(root)
    // An unrelated src subtree gets a newer mtime than dist, but it is NOT in srcDirs.
    mkdirSync(join(root, 'src', 'unrelated'), { recursive: true })
    writeFileSync(join(root, 'src', 'unrelated', 'notes.ts'), 'export const y = 1')

    const past = new Date(Date.now() - 60_000)
    const now = new Date()
    utimesSync(join(root, 'src', 'generators', 'codex.ts'), past, past)
    utimesSync(join(root, 'dist', 'generators', 'codex.js'), past, past)
    utimesSync(join(root, 'src', 'unrelated', 'notes.ts'), now, now)

    const result = checkDistFresh(root, { srcDirs: ['src/generators'] })
    expect(result.fresh).toBe(true)
  })
})
