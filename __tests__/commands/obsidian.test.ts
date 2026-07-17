// SPDX-License-Identifier: Apache-2.0
// TDD RED tests for #1979: `arbiter obsidian` — thin generic orchestrator that
// shells out to the vault scripts a consumer repo already received from arbiter
// (scripts/gen-wiki.mjs, scripts/check-wiki-lint.mjs). No new walker/wikilink
// engine — see ADR-107 for the CANON-16 reuse survey.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runObsidian } from '../../src/commands/obsidian.js'
import { initGit } from '../helpers.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const GEN_WIKI_SRC = join(repoRoot, 'scripts', 'gen-wiki.mjs')
const CHECK_WIKI_LINT_SRC = join(repoRoot, 'scripts', 'check-wiki-lint.mjs')

/** Build a temp "consumer repo" with the real emitted scripts + a docs/ corpus, committed. */
function makeVaultRepo(opts: { withScripts?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-obsidian-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })

  if (opts.withScripts !== false) {
    writeFileSync(join(dir, 'scripts', 'gen-wiki.mjs'), readFileSync(GEN_WIKI_SRC, 'utf-8'))
    writeFileSync(
      join(dir, 'scripts', 'check-wiki-lint.mjs'),
      readFileSync(CHECK_WIKI_LINT_SRC, 'utf-8'),
    )
  }

  writeFileSync(
    join(dir, 'docs', 'METHOD', 'FOO.md'),
    ['---', "title: 'Foo'", '---', '', '# Foo', '', 'Some content about foo.', ''].join('\n'),
  )

  initGit(dir)
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function listVaultFiles(dir: string, vaultDir = 'wiki'): string[] {
  const p = join(dir, vaultDir)
  if (!existsSync(p)) return []
  return execFileSync('find', [p, '-type', 'f'], { encoding: 'utf-8' }).trim().split('\n')
}

describe('arbiter obsidian (#1979)', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  // ── GREEN cases ──────────────────────────────────────────────────────────

  it('sync mode regenerates the vault and re-validates clean', () => {
    dir = makeVaultRepo()
    const result = runObsidian({ dir, sync: true })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('sync')
    expect(result.contractVersion).toBe(1)
    expect(result.regenerated).toBe(true)
    expect(result.validation?.ok).toBe(true)
    expect(existsSync(join(dir, 'wiki', 'INDEX.md'))).toBe(true)
  })

  it('validate-only mode reports clean on a freshly generated vault', () => {
    dir = makeVaultRepo()
    // Pre-generate via sync, then validate-only should be clean.
    runObsidian({ dir, sync: true })
    const result = runObsidian({ dir, validateOnly: true })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('validate')
    expect(result.validation?.ok).toBe(true)
    expect(result.validation?.brokenLinks).toBe(0)
    expect(result.validation?.orphans).toBe(0)
    expect(result.validation?.stale).toBe(0)
  })

  it('bare dry-run (default) writes nothing to the vault', () => {
    dir = makeVaultRepo()
    const before = listVaultFiles(dir)
    const result = runObsidian({ dir })
    expect(result.mode).toBe('dry-run')
    expect(existsSync(join(dir, 'wiki'))).toBe(false)
    const after = listVaultFiles(dir)
    expect(after).toEqual(before)
  })

  it('emits a --json envelope', () => {
    dir = makeVaultRepo()
    runObsidian({ dir, sync: true })
    const result = runObsidian({ dir, validateOnly: true, json: true })
    expect(result).toMatchObject({
      status: 'ok',
      exitCode: 0,
      mode: 'validate',
      contractVersion: 1,
      vaultDir: 'wiki',
    })
  })

  // ── RED / fail-closed cases ──────────────────────────────────────────────

  it('exits 1 on a broken [[wikilink]] in the vault', () => {
    dir = makeVaultRepo()
    runObsidian({ dir, sync: true })
    writeFileSync(
      join(dir, 'wiki', 'dangling.md'),
      ['---', "generated: true", "source: 'docs/METHOD/FOO.md'", "source_sha: 'x'", '---', '', '# Dangling', '', '[[NonExistentPage]]', ''].join('\n'),
    )
    const result = runObsidian({ dir, validateOnly: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.validation?.brokenLinks).toBeGreaterThan(0)
    expect(result.validation?.ok).toBe(false)
  })

  it('exits 1 on an orphan page unreachable from INDEX.md', () => {
    dir = makeVaultRepo()
    runObsidian({ dir, sync: true })
    writeFileSync(
      join(dir, 'wiki', 'orphan-page.md'),
      ['---', 'generated: true', "source: 'docs/METHOD/FOO.md'", "source_sha: 'x'", '---', '', '# Orphan', '', 'No inbound links.', ''].join(
        '\n',
      ),
    )
    const result = runObsidian({ dir, validateOnly: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.validation?.orphans).toBeGreaterThan(0)
  })

  it('exits 1 on a stale source_sha', () => {
    dir = makeVaultRepo()
    runObsidian({ dir, sync: true })
    const fooPage = join(dir, 'wiki', 'method-foo.md')
    const text = readFileSync(fooPage, 'utf-8')
    const staled = text.replace(/source_sha: '[0-9a-f]+'/, "source_sha: '0000000000000000000000000000000000000000'")
    expect(staled).not.toBe(text)
    writeFileSync(fooPage, staled)
    const result = runObsidian({ dir, validateOnly: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.validation?.stale).toBeGreaterThan(0)
  })

  it('exits 2 with an update hint when the vault scripts are missing', () => {
    dir = makeVaultRepo({ withScripts: false })
    const result = runObsidian({ dir, validateOnly: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toMatch(/arbiter update/)
  })

  it('exits 2 on conflicting mode flags', () => {
    dir = makeVaultRepo()
    const result = runObsidian({ dir, sync: true, validateOnly: true, write: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
  })

  it('exits 2 when the regen spawn fails during sync', () => {
    dir = makeVaultRepo()
    // Corrupt gen-wiki.mjs so the child process errors out (non-zero, non-lint failure).
    writeFileSync(join(dir, 'scripts', 'gen-wiki.mjs'), '#!/usr/bin/env node\nprocess.exit(17)\n')
    const result = runObsidian({ dir, sync: true })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
  })

  it('honors a custom --vault-path', () => {
    dir = makeVaultRepo()
    const result = runObsidian({ dir, sync: true, vaultPath: 'custom-vault' })
    expect(result.status).toBe('ok')
    expect(result.vaultDir).toBe('custom-vault')
    expect(existsSync(join(dir, 'custom-vault', 'INDEX.md'))).toBe(true)
    expect(existsSync(join(dir, 'wiki'))).toBe(false)
  })
})
