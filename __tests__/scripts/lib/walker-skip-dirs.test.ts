// SPDX-License-Identifier: Apache-2.0
// #1545 — pin the migrated walkers' SKIP_DIRS widening with a consumer fixture.
//
// The #1521 walker consolidation routed the remaining gate scripts through the shared
// scripts/lib/glob-walk.mjs `walkRepo`, whose SKIP_DIRS is a SUPERSET of the old per-script
// lists (it adds build/coverage/.coverage). On arbiter the visited set is identical, but a
// CONSUMER project with populated build/ or coverage/ inside a gate's scan root would silently
// skip those files. The direction is benign (ignore build artifacts) but was UNPINNED by any
// regression test. These tests pin, per migrated gate, the intended skip set so the widening
// can never drift further without a conscious test update.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

// Import the real shipped .mjs SSOT modules (never re-implementations) so the tests guard the
// files that actually run in the gate. Each migrated gate guards its top-level execution behind
// an import.meta.url check, so importing it here is side-effect free.
const { walkRepo, SKIP_DIRS } = (await import(join(REPO_ROOT, 'scripts/lib/glob-walk.mjs'))) as {
  walkRepo: (root: string) => string[]
  SKIP_DIRS: Set<string>
}
const orphan = (await import(join(REPO_ROOT, 'scripts/check-no-orphan-todo.mjs'))) as {
  SKIP_DIRS: Set<string>
  collectSourceFiles: (root: string) => string[]
}
const docStyle = (await import(join(REPO_ROOT, 'scripts/check-doc-style.mjs'))) as {
  SKIP_PATH_SEGMENTS: string[]
  walk: (dir: string) => string[]
}
const docLinks = (await import(join(REPO_ROOT, 'scripts/check-doc-links.mjs'))) as {
  SKIP_PATH_SEGMENTS: string[]
  findMarkdownFiles: (dir: string) => string[]
}
const templateTests = (await import(join(REPO_ROOT, 'scripts/check-template-tests.mjs'))) as {
  collectEjsFiles: (dir: string) => string[]
}

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'walker-skip-'))
  created.push(dir)
  return dir
}

/** Materialise `<root>/<dir>/<name>` (creating `dir`) with trivial content. */
function seed(root: string, dir: string, name: string, content = 'x'): void {
  const d = join(root, dir)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, name), content)
}

// The intended, frozen widened skip set (the #1521 widening). Adding/removing a dir here MUST be
// a conscious edit — that is the whole point of the pin.
const WIDENED_SKIP = [
  '.coverage',
  '.git',
  '__pycache__',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'venv',
]

describe('walkRepo SKIP_DIRS widening (#1545)', () => {
  it('SKIP_DIRS is exactly the intended widened set — pins the #1521 widening', () => {
    expect([...SKIP_DIRS].sort()).toEqual([...WIDENED_SKIP].sort())
  })

  it('a consumer scan root with populated build/coverage/.coverage prunes exactly those', () => {
    const root = fixture()
    writeFileSync(join(root, 'a.md'), 'x')
    seed(root, 'sub', 'b.md')
    for (const d of WIDENED_SKIP) seed(root, d, 'leak.md')
    expect(walkRepo(root).sort()).toEqual(['a.md', 'sub/b.md'])
  })
})

// ── Per-gate skip-set pins ───────────────────────────────────────────────────
// Each migrated gate re-applies its OWN skip on top of walkRepo's widened SKIP_DIRS. A gate's
// intended skip set = walkRepo SKIP_DIRS ∪ gate-specific. We assert both halves behaviourally so
// neither the widening nor a gate's own exclusions can silently drift.

function rels(root: string, abs: string[]): string[] {
  return abs.map((f) => f.slice(root.length + 1).replace(/\\/g, '/')).sort()
}

describe('check-no-orphan-todo skip set (#1544/#1545)', () => {
  it('keeps source files but prunes its own `templates` skip AND the walkRepo widening', () => {
    const root = fixture()
    // Content is irrelevant — collectSourceFiles selects by directory + extension only. (Neutral
    // bodies, so this fixture never trips the orphan-TODO gate that scans __tests__.)
    writeFileSync(join(root, 'keep.ts'), 'const a = 1')
    seed(root, 'templates', 'leak.ts', 'const b = 2') // gate-specific skip
    seed(root, 'build', 'leak.ts', 'const c = 3') // walkRepo widening
    seed(root, 'node_modules', 'leak.ts', 'const d = 4')
    writeFileSync(join(root, 'skip.md'), 'not a source extension')
    expect(orphan.SKIP_DIRS.has('templates')).toBe(true)
    expect(rels(root, orphan.collectSourceFiles(root))).toEqual(['keep.ts'])
  })
})

// #2408 flipped `internal` from skipped to SCANNED in both doc gates — the SSOT
// backbone was the one tree neither gate ever looked at. These cases now assert
// the inverse: api/ (generated API reference) is still pruned, internal/ is not.

describe('check-doc-style skip set (#1544/#1545, #2408)', () => {
  it('exposes its SKIP_PATH_SEGMENTS, prunes api + the walkRepo widening, and SCANS internal', () => {
    expect(docStyle.SKIP_PATH_SEGMENTS.some((s) => s.includes('api'))).toBe(true)
    expect(docStyle.SKIP_PATH_SEGMENTS.some((s) => s.includes('internal'))).toBe(false)
    const root = fixture()
    writeFileSync(join(root, 'keep.md'), '# k')
    seed(root, 'api', 'leak.md', '# l') // gate-specific path segment
    seed(root, 'internal', 'covered.md', '# c')
    seed(root, 'build', 'leak.md', '# l') // walkRepo widening
    expect(rels(root, docStyle.walk(root))).toEqual(['internal/covered.md', 'keep.md'])
  })
})

describe('check-doc-links skip set (#1544/#1545, #2408)', () => {
  it('exposes its SKIP_PATH_SEGMENTS, prunes api + the walkRepo widening, and SCANS internal', () => {
    expect(docLinks.SKIP_PATH_SEGMENTS.some((s) => s.includes('api'))).toBe(true)
    expect(docLinks.SKIP_PATH_SEGMENTS.some((s) => s.includes('internal'))).toBe(false)
    const root = fixture()
    writeFileSync(join(root, 'keep.md'), '# k')
    seed(root, 'api', 'leak.md', '# l')
    seed(root, 'internal', 'covered.md', '# c')
    seed(root, 'coverage', 'leak.md', '# l') // walkRepo widening
    expect(rels(root, docLinks.findMarkdownFiles(root))).toEqual(['internal/covered.md', 'keep.md'])
  })
})

describe('check-template-tests skip set (#1544/#1545)', () => {
  it('collects .ejs via walkRepo and prunes the walkRepo widening (node_modules/build)', () => {
    const root = fixture()
    writeFileSync(join(root, 'keep.mjs.ejs'), 't')
    seed(root, 'nested', 'deep.mjs.ejs', 't')
    seed(root, 'node_modules', 'leak.ejs', 't') // walkRepo widening
    seed(root, 'build', 'leak.ejs', 't')
    expect(rels(root, templateTests.collectEjsFiles(root))).toEqual([
      'keep.mjs.ejs',
      'nested/deep.mjs.ejs',
    ])
  })
})
