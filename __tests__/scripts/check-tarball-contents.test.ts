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
import {
  classifyTarball,
  findMissingRequired,
  FORBIDDEN,
  REQUIRED,
} from '../../scripts/check-tarball-contents.mjs'

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

describe('findMissingRequired — required runtime-asset presence (#1575)', () => {
  it('flags a manifest missing dist/kit/catalog.json AND dist/kit/derived.json', () => {
    const m = findMissingRequired(['dist/cli.js', 'README.md'])
    expect(m).toHaveLength(REQUIRED.length)
    expect(m.map((x) => x.label).join(' ')).toMatch(/catalog\.json/)
    expect(m.map((x) => x.label).join(' ')).toMatch(/derived\.json/)
  })

  it('flags a manifest that ships only the kit .js but not the runtime JSON', () => {
    // Exactly the #1575 bug: tsc emits dist/kit/*.js but the JSON is never copied.
    const m = findMissingRequired(['dist/kit/catalog.js', 'dist/kit/derived.js', 'dist/cli.js'])
    expect(m).toHaveLength(2)
  })

  it('passes a manifest that ships both kit runtime data files', () => {
    const m = findMissingRequired([
      'dist/cli.js',
      'dist/kit/catalog.js',
      'dist/kit/catalog.json',
      'dist/kit/derived.json',
    ])
    expect(m).toEqual([])
  })

  it('normalises backslash separators and leading ./ before matching', () => {
    const m = findMissingRequired(['.\\dist\\kit\\catalog.json', './dist/kit/derived.json'])
    expect(m).toEqual([])
  })

  it('exposes a non-empty declarative required-rule list', () => {
    expect(REQUIRED.length).toBeGreaterThanOrEqual(2)
  })
})

describe('package.json build ships kit runtime data into dist/ (#1575)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
    files: string[]
    scripts: Record<string, string>
  }

  it('the build script copies the kit catalog + derived JSON next to the emitted dist/kit/*.js', () => {
    // tsc emits dist/kit/*.js but NOT the data files the code reads at runtime; the
    // build must co-locate them or `arbiter kit` throws ENOENT in a published install.
    expect(pkg.scripts.build).toMatch(/dist\/kit/)
    expect(pkg.scripts.build).toMatch(/catalog\.json/)
    expect(pkg.scripts.build).toMatch(/derived\.json/)
  })

  it('the build derives the kit data (build-kit) before copying it', () => {
    // derived.json is generated + gitignored, so a clean publish must regenerate it
    // before the copy step or the cp fails on a fresh checkout.
    expect(pkg.scripts.build).toMatch(/build-kit\.mjs/)
  })

  it('ships the dist/ subtree (which now carries dist/kit/*.json) in files[]', () => {
    expect(pkg.files).toContain('dist')
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
