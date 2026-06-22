// SPDX-License-Identifier: Apache-2.0
//
// Regression coverage for the published-tarball content guard (#1491, tarball-leak major).
//
// Three surfaces are pinned here:
//   1. classifyTarball() — the pure forbidden-path logic. A manifest containing a
//      docs/internal/** runbook or a *.arbiter-backup editor artifact must be flagged;
//      a clean manifest must pass. Path normalisation (backslashes / leading "./")
//      is covered so the matcher is platform- and form-robust.
//   2. The package.json "files" allowlist — must negate the offending subpaths so a
//      wholesale "docs" entry cannot silently re-include them. This is the actual fix:
//      `npm pack` honours `!docs/internal` / `!docs/**/*.arbiter-backup` in files[],
//      whereas an in-directory `.npmignore` subpath is ignored once the parent is listed.
//   3. The release-build + prepublishOnly wiring — the guard runs as an early CI
//      signal in the release build AND at the publish boundary (mirrors the
//      pack-size guard placement; `npm pack` is too heavy for the per-commit L1 gate).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyTarball, FORBIDDEN } from '../../scripts/check-tarball-contents.mjs'

describe('classifyTarball — forbidden-path detection (#1491 tarball-leak)', () => {
  it('flags a docs/internal/** maintainer runbook', () => {
    const v = classifyTarball(['dist/cli.js', 'docs/internal/release-playbook.md', 'README.md'])
    expect(v).toHaveLength(1)
    expect(v[0]?.path).toBe('docs/internal/release-playbook.md')
    expect(v[0]?.label).toMatch(/internal/i)
  })

  it('flags a stray *.arbiter-backup working-tree artifact', () => {
    const v = classifyTarball(['docs/METHOD/SSOT_CORE_SET.md.arbiter-backup'])
    expect(v).toHaveLength(1)
    expect(v[0]?.label).toMatch(/backup/i)
  })

  it('flags the bare docs/internal directory entry itself', () => {
    expect(classifyTarball(['docs/internal'])).toHaveLength(1)
  })

  it('passes a clean public manifest (no forbidden paths)', () => {
    const clean = [
      'dist/cli.js',
      'docs/ADR/001-foo.md',
      'docs/METHOD/ENGINEERING_DEFAULTS.md',
      'README.md',
      'LICENSE',
      'PRIVACY.md',
    ]
    expect(classifyTarball(clean)).toEqual([])
  })

  it('does NOT false-positive on a public doc that merely contains the word internal', () => {
    // Substring "internal" inside a filename under a public dir must not trip the rule —
    // only the docs/internal/ path prefix is forbidden.
    expect(classifyTarball(['docs/METHOD/internal-api-notes.md'])).toEqual([])
  })

  it('normalises backslash separators and leading ./ before matching', () => {
    expect(classifyTarball(['docs\\internal\\x.md'])).toHaveLength(1)
    expect(classifyTarball(['./docs/internal/x.md'])).toHaveLength(1)
  })

  it('exposes a non-empty declarative rule list', () => {
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(2)
  })
})

describe('package.json files[] negates the leak subpaths (#1491 the actual fix)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { files: string[] }

  it('still ships docs wholesale (the public doc set is intended to publish)', () => {
    expect(pkg.files).toContain('docs')
  })

  it('negates docs/internal so maintainer runbooks never ship', () => {
    expect(pkg.files).toContain('!docs/internal')
  })

  it('negates *.arbiter-backup so editor artifacts never ship', () => {
    expect(pkg.files).toContain('!docs/**/*.arbiter-backup')
  })

  it('the negation entries appear AFTER the docs entry (npm applies in order)', () => {
    const docsIdx = pkg.files.indexOf('docs')
    expect(pkg.files.indexOf('!docs/internal')).toBeGreaterThan(docsIdx)
    expect(pkg.files.indexOf('!docs/**/*.arbiter-backup')).toBeGreaterThan(docsIdx)
  })
})

describe('the tarball guard is wired into the release build + publish boundary (#1491)', () => {
  it('the release workflow runs the tarball-contents guard as an early signal', () => {
    const releaseYml = readFileSync(resolve('.github/workflows/05-release.yml'), 'utf-8')
    expect(releaseYml).toMatch(/check-tarball-contents\.mjs/)
  })

  it('prepublishOnly runs the tarball-contents guard in --strict mode', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.prepublishOnly).toMatch(/check-tarball-contents\.mjs --strict/)
  })
})
