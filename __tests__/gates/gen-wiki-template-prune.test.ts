// SPDX-License-Identifier: Apache-2.0
// TDD regression tests for #2530: port the #2482 orphan-page prune from the
// self-hosted scripts/gen-wiki.mjs into src/templates/scripts/gen-wiki.mjs.ejs
// — the template every governed project's `arbiter init` emits. Without this,
// every governed project inherits the #2482 defect: wiki/ is gitignored, so a
// page whose source doc is gone survives every regeneration forever and later
// fails the emitted check-wiki-lint.mjs's citation check on a file the
// developer never wrote.
//
// Mirrors __tests__/gates/gen-wiki-prune-2482.test.ts case-for-case, but
// exercises the TEMPLATE's rendered output (what a governed project actually
// receives) rather than the self-hosted script directly.
//
// Ownership rule (must match the ported scripts/gen-wiki.mjs generatePage()):
// every generated page carries `generated: true` and `source: '<path>'` in
// its frontmatter. Prune only deletes a wiki/*.md file when BOTH are true: it
// is generator-owned (has that frontmatter) AND its source is no longer in
// the current full source set. A hand-written file with no such frontmatter
// is never touched.
//
// The --changed trap: in `--changed` mode only `changedSources` get
// rewritten, but the prune reference set must still come from the FULL
// source list — never from `changedSources` — or an incremental run would
// delete every page it simply didn't rewrite this time.
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
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
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const tempDirs: string[] = []

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' })
  expect(result.status, `${command} ${args.join(' ')} failed:\n${result.stderr}`).toBe(0)
  return result.stdout
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gen-wiki-template-prune-'))
  tempDirs.push(repo)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  const rendered = renderTemplate(
    'scripts/gen-wiki.mjs.ejs',
    makeConfig(repo, { governanceLevel: 'L2' }) as unknown as Record<string, unknown>,
  )
  writeFileSync(join(repo, 'scripts', 'gen-wiki.mjs'), rendered, 'utf-8')
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

describe('gen-wiki.mjs.ejs (rendered) build-mode prune (#2530, ports #2482)', () => {
  it('removes the orphan page after its source doc is deleted and regenerated', () => {
    const repo = createRepo()
    const first = runGenerator(repo)
    expect(first.status).toBe(0)
    expect(existsSync(join(vault(repo), 'alpha.md'))).toBe(true)
    expect(existsSync(join(vault(repo), 'beta.md'))).toBe(true)

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
    // alpha's source still exists and was not stale this run — the trap: a
    // buggy implementation that prunes against `changedSources` instead of
    // the full source set would delete alpha.md here since it was not part
    // of the rewritten subset.
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
