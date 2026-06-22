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

describe('package.json files[] does not ship docs wholesale — whitelist the one runtime file (#1491)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { files: string[] }

  it('does NOT ship the docs/ tree wholesale (so internal/backup cannot leak by construction)', () => {
    // The human-only docs tree (ADR/REFERENCE/PRODUCT/METHOD/…, ~1.1 MB) lives on the website +
    // repo, not in the npm tarball. Whitelisting beats blacklisting: a new docs subdir can never
    // re-introduce a leak, and the package stays well under the 5 MB cap.
    expect(pkg.files).not.toContain('docs')
    expect(pkg.files.filter((f) => f.startsWith('docs/') && !f.startsWith('!'))).toEqual([
      'docs/audits/kit-canonical-mapping.json',
    ])
  })

  it('ships the one bundled doc the CLI reads at runtime (kit parity check)', () => {
    // kit.js resolves this against the package root; dropping it would break `arbiter kit`.
    expect(pkg.files).toContain('docs/audits/kit-canonical-mapping.json')
  })

  it('carries no stale negation entries (whitelist makes them unnecessary)', () => {
    expect(pkg.files.some((f) => f.startsWith('!'))).toBe(false)
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
