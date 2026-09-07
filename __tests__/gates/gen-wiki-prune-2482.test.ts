// SPDX-License-Identifier: Apache-2.0
// TDD regression tests for #2482: gen-wiki.mjs build mode must prune wiki/
// pages whose source doc is gone, instead of only ever adding pages.
//
// Bug: wiki/ is gitignored, so orphan pages survive a `git checkout` to
// another branch and later fail check-wiki-lint.mjs's citation check on a
// file the developer never wrote. Regeneration must be idempotent against
// the CURRENT source set: after a build run, wiki/ holds pages for exactly
// the current sources, plus the synthetic files (INDEX.md, .wiki-log.json),
// and nothing else.
//
// Ownership rule (verified against scripts/gen-wiki.mjs generatePage()):
// every generated page carries `generated: true` and `source: '<path>'` in
// its frontmatter. Prune only deletes a wiki/*.md file when BOTH are true:
// it is generator-owned (has that frontmatter) AND its source is no longer
// in the current full source set. A hand-written file with no such
// frontmatter is never touched.
//
// The --changed trap (verified against scripts/gen-wiki.mjs build mode):
// in `--changed` mode only `changedSources` get rewritten, but `allSlugs`
// (and therefore the prune reference set) must still come from the FULL
// source list — never from `changedSources` — or an incremental run would
// delete every page it simply didn't rewrite this time.
//
// No source-root/docs-dir override exists in gen-wiki.mjs (only
// `--wiki-dir` is supported — DOCS_DIR is hardcoded to `join(ROOT, 'docs')`
// where ROOT is resolved from the *script file's own location*, not cwd).
// So, like the pre-existing __tests__/gates/gen-wiki-changed.test.ts, these
// tests copy the generator into a fresh temp git repo per case: ROOT then
// resolves inside that temp repo, and the real project's docs/ and wiki/
// are never touched. Each generator invocation additionally passes
// `--wiki-dir vault` to target a non-default vault dir, per the generator's
// documented #1979 override.

import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const generator = join(root, 'scripts', 'gen-wiki.mjs')
const tempDirs: string[] = []

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' })
  expect(result.status, `${command} ${args.join(' ')} failed:\n${result.stderr}`).toBe(0)
  return result.stdout
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gen-wiki-prune-'))
  tempDirs.push(repo)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  copyFileSync(generator, join(repo, 'scripts', 'gen-wiki.mjs'))
  writeFileSync(join(repo, 'docs', 'alpha.md'), '# Alpha\n\nAlpha content.\n')
  writeFileSync(join(repo, 'docs', 'beta.md'), '# Beta\n\nBeta content.\n')
  run('git', ['init'], repo)
  run('git', ['config', 'user.email', 'test@example.com'], repo)
  run('git', ['config', 'user.name', 'Test User'], repo)
  run('git', ['add', '.'], repo)
  run('git', ['commit', '-m', 'initial wiki sources'], repo)
  return repo
}

function runGenerator(repo: string, ...args: string[]): { stdout: string; status: number | null } {
  const result = spawnSync('node', ['scripts/gen-wiki.mjs', '--wiki-dir', 'vault', ...args], {
    cwd: repo,
    encoding: 'utf-8',
  })
  return { stdout: result.stdout, status: result.status }
}

function vault(repo: string): string {
  return join(repo, 'vault')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('gen-wiki.mjs build-mode prune (#2482)', () => {
  it('AC-2: removes the orphan page after its source doc is deleted and regenerated', () => {
    const repo = createRepo()
    const first = runGenerator(repo)
    expect(first.status).toBe(0)
    expect(existsSync(join(vault(repo), 'alpha.md'))).toBe(true)
    expect(existsSync(join(vault(repo), 'beta.md'))).toBe(true)

    // Remove one source doc and commit the removal.
    rmSync(join(repo, 'docs', 'beta.md'))
    run('git', ['add', '-A'], repo)
    run('git', ['commit', '-m', 'remove beta doc'], repo)

    const second = runGenerator(repo)
    expect(second.status).toBe(0)
    expect(existsSync(join(vault(repo), 'alpha.md'))).toBe(true)
    expect(existsSync(join(vault(repo), 'beta.md'))).toBe(false)
    expect(second.stdout).toContain('1 page(s) pruned')
  })

  it('leaves a hand-written wiki page with no generated/source frontmatter untouched', () => {
    const repo = createRepo()
    runGenerator(repo)
    mkdirSync(vault(repo), { recursive: true })
    writeFileSync(join(vault(repo), 'human-notes.md'), '# Human notes\n\nNot generated.\n')

    // Remove a real source too, to prove prune runs and still spares the
    // hand-written file specifically because it lacks ownership frontmatter.
    rmSync(join(repo, 'docs', 'beta.md'))
    run('git', ['add', '-A'], repo)
    run('git', ['commit', '-m', 'remove beta doc'], repo)

    const result = runGenerator(repo)
    expect(result.status).toBe(0)
    expect(existsSync(join(vault(repo), 'human-notes.md'))).toBe(true)
    expect(readFileSync(join(vault(repo), 'human-notes.md'), 'utf-8')).toContain('Not generated.')
    expect(existsSync(join(vault(repo), 'beta.md'))).toBe(false)
  })

  it('never prunes INDEX.md or .wiki-log.json', () => {
    const repo = createRepo()
    runGenerator(repo)
    rmSync(join(repo, 'docs', 'beta.md'))
    run('git', ['add', '-A'], repo)
    run('git', ['commit', '-m', 'remove beta doc'], repo)

    runGenerator(repo)
    expect(existsSync(join(vault(repo), 'INDEX.md'))).toBe(true)
    expect(existsSync(join(vault(repo), '.wiki-log.json'))).toBe(true)
  })

  it('--changed prunes genuine orphans but never deletes a page whose source still exists and simply was not rewritten', () => {
    const repo = createRepo()
    runGenerator(repo) // full build: alpha.md + beta.md pages exist

    // Remove beta's source (genuine orphan) but leave alpha untouched, so a
    // --changed run has nothing stale to rewrite for alpha at all.
    rmSync(join(repo, 'docs', 'beta.md'))
    run('git', ['add', '-A'], repo)
    run('git', ['commit', '-m', 'remove beta doc'], repo)

    const result = runGenerator(repo, '--changed')
    expect(result.status).toBe(0)
    // alpha's source still exists and was not stale this run — the trap:
    // a buggy implementation that prunes against `changedSources` instead
    // of the full source set would delete alpha.md here since it was not
    // part of the rewritten subset.
    expect(existsSync(join(vault(repo), 'alpha.md'))).toBe(true)
    // beta's source is genuinely gone — it must still be pruned even in
    // --changed mode.
    expect(existsSync(join(vault(repo), 'beta.md'))).toBe(false)
    expect(result.stdout).toContain('1 page(s) pruned')
  })

  it('reports zero pruned and deletes nothing when there is nothing to prune', () => {
    const repo = createRepo()
    runGenerator(repo)
    const filesBefore = readdirSync(vault(repo)).sort()

    const result = runGenerator(repo)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 page(s) pruned')
    expect(readdirSync(vault(repo)).sort()).toEqual(filesBefore)
  })
})
