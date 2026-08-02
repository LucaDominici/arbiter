// SPDX-License-Identifier: Apache-2.0
// #1840 F4 tranche 4 (examples/ viventi) — unit tests for the PURE logic in
// scripts/regenerate-examples.mjs: argument parsing and the directory-diff
// used by both `--check` (CI drift gate) and the local `examples:check`
// script. Deliberately does NOT invoke `arbiter init` / spawn the built
// dist/cli.js — that end-to-end path is covered by the Generator Matrix
// workflow's "Living examples drift" step (`.github/workflows/
// generator-matrix.yml`), which has the toolchain and a built dist/. This
// suite stays offline/fast so it runs at L1.
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIVING_EXAMPLES, diffDirs, parseArgs } from '../../scripts/regenerate-examples.mjs'

describe('regenerate-examples — parseArgs', () => {
  it('defaults to write mode with no stack filter', () => {
    expect(parseArgs([])).toEqual({ check: false, stack: null })
  })

  it('recognizes --check', () => {
    expect(parseArgs(['--check'])).toEqual({ check: true, stack: null })
  })

  it('recognizes --stack=<lang> alongside --check', () => {
    expect(parseArgs(['--check', '--stack=go'])).toEqual({ check: true, stack: 'go' })
  })
})

describe('regenerate-examples — LIVING_EXAMPLES (#1840 tranche-2 GA stacks)', () => {
  it('is exactly the 3 README-supported stacks, all on the library archetype', () => {
    expect(LIVING_EXAMPLES.map((e) => e.language).sort()).toEqual(['go', 'python', 'typescript'])
    for (const example of LIVING_EXAMPLES) {
      expect(example.archetype).toBe('library')
      // Directory/fixture naming convention: `<language>-library` mirrors the
      // `<language>-<archetype>` convention documented in examples/README.md.
      expect(example.name).toBe(example.fixture)
    }
  })

  it('keeps every living fixture on the current generated script surface (AC-2126.1, AC-2126.2)', () => {
    for (const example of LIVING_EXAMPLES) {
      expect(existsSync(join('examples', example.name, 'scripts', 'pr-merge-watch.mjs'))).toBe(true)
    }
  })
})

describe('regenerate-examples — diffDirs', () => {
  let committed: string
  let fresh: string

  beforeEach(() => {
    const parent = mkdtempSync(join(tmpdir(), 'arbiter-examples-diff-'))
    committed = join(parent, 'committed')
    fresh = join(parent, 'fresh')
    mkdirSync(committed, { recursive: true })
    mkdirSync(fresh, { recursive: true })
  })

  afterEach(() => {
    rmSync(committed, { recursive: true, force: true })
    rmSync(fresh, { recursive: true, force: true })
  })

  it('reports no drift when both trees are byte-identical', () => {
    writeFileSync(join(committed, 'a.txt'), 'hello\n')
    writeFileSync(join(fresh, 'a.txt'), 'hello\n')
    expect(diffDirs(committed, fresh)).toEqual({ removed: [], added: [], changed: [] })
  })

  it('reports a changed file when content differs', () => {
    writeFileSync(join(committed, 'a.txt'), 'hello\n')
    writeFileSync(join(fresh, 'a.txt'), 'goodbye\n')
    expect(diffDirs(committed, fresh)).toEqual({ removed: [], added: [], changed: ['a.txt'] })
  })

  it('reports added/removed files distinctly from changed files', () => {
    writeFileSync(join(committed, 'only-committed.txt'), 'x\n')
    writeFileSync(join(fresh, 'only-fresh.txt'), 'y\n')
    expect(diffDirs(committed, fresh)).toEqual({
      removed: ['only-committed.txt'],
      added: ['only-fresh.txt'],
      changed: [],
    })
  })

  it('never surfaces .git as a diffed path', () => {
    mkdirSync(join(fresh, '.git'), { recursive: true })
    writeFileSync(join(fresh, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    expect(diffDirs(committed, fresh)).toEqual({ removed: [], added: [], changed: [] })
  })

  it('treats a non-existent committed dir as fully-added (first regeneration)', () => {
    rmSync(committed, { recursive: true, force: true })
    writeFileSync(join(fresh, 'a.txt'), 'hello\n')
    expect(diffDirs(committed, fresh)).toEqual({ removed: [], added: ['a.txt'], changed: [] })
  })
})
