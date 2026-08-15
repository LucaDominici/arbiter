// SPDX-License-Identifier: Apache-2.0
// AC-2243.2 (#2243): prose citations of a nonexistent repo file path
// (`src/ship/fix-on-red.ts` class — arc42.md:190/414, c4-model.md:111 cite it
// as if live, though the file was removed in the T2 command-surface cut) go
// undetected today: check-phantom-command-scan.mjs is command-shaped
// (`arbiter <cmd>` citations vs src/cli.ts), check-doc-links.mjs resolves
// markdown LINK targets (`[text](href)`), and neither matches a bare
// inline-code path citation. RED: no scanner for this class exists.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { extractPathCitations, findPhantomPaths } from '../../scripts/check-doc-path-citations.mjs'

const SCRIPT = resolve('scripts/check-doc-path-citations.mjs')

// ─── extractPathCitations ──────────────────────────────────────────────────

describe('extractPathCitations', () => {
  it('extracts a bare backtick-wrapped repo path citation', () => {
    expect(extractPathCitations('See `src/ship/fix-on-red.ts` for details.')).toEqual(
      new Set(['src/ship/fix-on-red.ts']),
    )
  })

  it('does NOT match a full command-line example in one backtick span (shell/example snippet guard)', () => {
    expect(extractPathCitations('Run `node scripts/check-all.mjs L1` before commit.')).toEqual(
      new Set(),
    )
  })

  it('does NOT match a bare word with no slash or extension', () => {
    expect(extractPathCitations('Run `arbiter graph` to build the graph.')).toEqual(new Set())
  })

  // #2260: ~50 corpus citations name a path in a GOVERNED TARGET and carry the
  // `<project>/` prefix the corpus already uses (docs/INTEGRATIONS.md). The
  // convention only works because a leading `<` cannot start a path match — pin
  // it, or relaxing the regex would silently red every one of those citations.
  it('does NOT match a `<project>/`-prefixed citation (governed-target path)', () => {
    expect(extractPathCitations('Emits `<project>/scripts/check-iso9001.mjs`.')).toEqual(new Set())
  })
})

// ─── findPhantomPaths ───────────────────────────────────────────────────────

describe('findPhantomPaths', () => {
  it('flags a cited path that does not exist under root', () => {
    expect(findPhantomPaths(new Set(['src/ship/fix-on-red.ts']), resolve('.'))).toEqual([
      'src/ship/fix-on-red.ts',
    ])
  })

  it('does not flag a cited path that exists under root', () => {
    expect(findPhantomPaths(new Set(['package.json']), resolve('.'))).toEqual([])
  })

  it('skips a runtime-generated root (.arbiter/) even when absent from a fresh checkout', () => {
    expect(findPhantomPaths(new Set(['.arbiter/e2e-ledger.jsonl']), resolve('.'))).toEqual([])
  })

  it('skips a URL', () => {
    expect(findPhantomPaths(new Set(['https://example.com/foo.js']), resolve('.'))).toEqual([])
  })

  it("resolves a `../`-leading citation against the citing file's directory, not repoRoot", () => {
    // package.json lives at repo root; a doc under docs/api/ citing `../../package.json`
    // means "repo root" relative to ITS OWN location, not two levels above repoRoot.
    const repoRoot = resolve('.')
    const fileDir = resolve('.', 'docs', 'api')
    expect(findPhantomPaths(new Set(['../../package.json']), repoRoot, fileDir)).toEqual([])
  })
})

// ─── end-to-end: synthetic phantom fails closed ────────────────────────────

describe('check-doc-path-citations.mjs — synthetic phantom fails closed (AC-2243.2)', () => {
  it('exits 1 when a doc cites a nonexistent repo path (fix-on-red.ts class)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-citation-'))
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'arc42.md'),
        '`src/ship/fix-on-red.ts` computes a stable failure signature.\n',
      )
      const r = spawnSync('node', [SCRIPT, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
        cwd: dir,
      })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('src/ship/fix-on-red.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the cited path exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-citation-ok-'))
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'real.ts'), 'export const x = 1\n')
      writeFileSync(join(dir, 'docs', 'ref.md'), 'See `src/real.ts` for details.\n')
      const r = spawnSync('node', [SCRIPT, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
        cwd: dir,
      })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when a shell/example snippet cites a nonexistent path inline with a command (false-positive corpus)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-citation-shell-'))
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'usage.md'),
        'Run `node scripts/does-not-exist.mjs --check` to validate.\n' +
          'Also: `arbiter ship #NNN --advance`, `arbiter init --recipe <url>`, ' +
          "`arbiter update --governance`, `arbiter verify tdd '#NNN'`.\n",
      )
      const r = spawnSync('node', [SCRIPT, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
        cwd: dir,
      })
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom-path:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── end-to-end: real repo, historical-mention allowlist ───────────────────

describe('check-doc-path-citations.mjs — real repo (AC-2243.4 local proof)', () => {
  it('does not flag docs/REFERENCE/fix-on-red.md — allowlisted historical mention', () => {
    const r = spawnSync('node', [SCRIPT, '--roots=docs/REFERENCE'], {
      encoding: 'utf-8',
      cwd: resolve('.'),
    })
    expect(r.stdout).not.toContain('fix-on-red.md: `src/ship/fix-on-red.ts`')
  })
})

// ─── #2260: promotion advisory → hard ───────────────────────────────────────
// RED: the check is registered with runWarnCheck (advisory) and the full corpus
// carries 124 dead citations, so promoting it today would red the gate. Both
// assertions below fail until the corpus is triaged and the check is flipped.

describe('#2260 — doc path citations is a HARD gate', () => {
  it('check-all.mjs registers it via runCheck, not runWarnCheck', () => {
    const checkAll = readFileSync(resolve('scripts/check-all.mjs'), 'utf-8')
    const line = checkAll
      .split('\n')
      .find((l) => l.includes("'scripts/check-doc-path-citations.mjs'"))
    expect(line, 'check-doc-path-citations.mjs must be registered in check-all.mjs').toBeDefined()
    expect(line).toContain('runCheck(')
    expect(line).not.toContain('runWarnCheck(')
  })

  it('exits 0 on the full committed corpus (docs/, website/, .claude/)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('phantom-path:')
    expect(r.status).toBe(0)
  })
})
