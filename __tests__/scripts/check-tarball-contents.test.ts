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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  classifyTarball,
  findMissingRequired,
  derivedEngineScripts,
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

describe('findMissingRequired — required runtime-asset presence (#1575, #1801)', () => {
  it('flags a manifest missing dist/kit/catalog.json, derived.json AND canonical-mapping.json', () => {
    const m = findMissingRequired(['dist/cli.js', 'README.md'])
    expect(m).toHaveLength(REQUIRED.length)
    expect(m.map((x) => x.label).join(' ')).toMatch(/catalog\.json/)
    expect(m.map((x) => x.label).join(' ')).toMatch(/derived\.json/)
    expect(m.map((x) => x.label).join(' ')).toMatch(/canonical-mapping\.json/)
  })

  it('flags a manifest that ships only the kit .js but not the runtime JSON', () => {
    // Exactly the #1575 bug: tsc emits dist/kit/*.js but the JSON is never copied.
    // Missing all 3 kit JSON entries plus all 6 doc-set/gold-audit engine entries.
    const m = findMissingRequired(['dist/kit/catalog.js', 'dist/kit/derived.js', 'dist/cli.js'])
    expect(m).toHaveLength(REQUIRED.length)
  })

  it('passes a manifest that ships every required runtime asset', () => {
    const m = findMissingRequired([
      'dist/cli.js',
      'dist/kit/catalog.js',
      'dist/kit/catalog.json',
      'dist/kit/derived.json',
      'dist/kit/canonical-mapping.json',
      'scripts/check-doc-set.mjs',
      'scripts/gold-audit.mjs',
      'scripts/check-doc-freshness.mjs',
      'scripts/check-doc-style.mjs',
      'scripts/lib/doc-set-resolve.mjs',
      'scripts/lib/gold-audit-lib.mjs',
    ])
    expect(m).toEqual([])
  })

  it('normalises backslash separators and leading ./ before matching', () => {
    const m = findMissingRequired([
      '.\\dist\\kit\\catalog.json',
      './dist/kit/derived.json',
      './dist/kit/canonical-mapping.json',
      './scripts/check-doc-set.mjs',
      './scripts/gold-audit.mjs',
      './scripts/check-doc-freshness.mjs',
      './scripts/check-doc-style.mjs',
      './scripts/lib/doc-set-resolve.mjs',
      './scripts/lib/gold-audit-lib.mjs',
    ])
    expect(m).toEqual([])
  })

  it('exposes a non-empty declarative required-rule list', () => {
    expect(REQUIRED.length).toBeGreaterThanOrEqual(2)
  })

  it('flags a manifest missing the doc-set/gold-audit engine scripts (#2348)', () => {
    // src/commands/doc-set.ts and gold-audit.ts shell out to these at runtime
    // (packageRoot()/scripts/*.mjs) — omitted from files[] until #2348, so every
    // real consumer install threw MODULE_NOT_FOUND on `arbiter doc-set`/`gold-audit`.
    const m = findMissingRequired(['dist/cli.js', 'dist/kit/catalog.json'], derivedEngineScripts())
    const labels = m.map((x) => x.label).join(' ')
    expect(labels).toMatch(/check-doc-set\.mjs/)
    expect(labels).toMatch(/gold-audit\.mjs/)
    expect(labels).toMatch(/check-doc-freshness\.mjs/)
    expect(labels).toMatch(/check-doc-style\.mjs/)
    expect(labels).toMatch(/lib\/doc-set-resolve\.mjs/)
    expect(labels).toMatch(/lib\/gold-audit-lib\.mjs/)
  })
})

// #2480: the #2348 fix was a hand-maintained list of literal paths, so it never ratcheted and a
// FOURTH engine (check-arc42-slots.mjs) shipped unshipped two waves later. The set is derived now,
// and these tests are what stop it silently reverting to a list.
describe('derivedEngineScripts — the engine set is derived, not hand-listed (#2480)', () => {
  it('finds every engine the CLI resolves against packageRoot(), including arc42', () => {
    const engines = derivedEngineScripts()
    expect(engines).toContain('scripts/check-doc-set.mjs')
    expect(engines).toContain('scripts/check-doc-freshness.mjs')
    expect(engines).toContain('scripts/gold-audit.mjs')
    expect(engines).toContain('scripts/check-arc42-slots.mjs')
  })

  it('every derived engine is actually in package.json files[] — the omission that shipped twice', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { files: string[] }
    for (const engine of derivedEngineScripts()) {
      expect(pkg.files, `${engine} is resolved at runtime but not shipped`).toContain(engine)
    }
  })

  it('a new route in engineFor() is required automatically, with no list to remember', () => {
    // The whole point: adding an engine to the resolver makes it required without touching this
    // gate. Proven against a synthetic resolver source rather than by editing the real one.
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-derive-'))
    try {
      mkdirSync(join(dir, 'src/commands'), { recursive: true })
      for (const f of ['doc-set.ts', 'gold-audit.ts']) {
        writeFileSync(
          join(dir, 'src/commands', f),
          `const s = resolve(packageRoot(), 'scripts/check-brand-new-engine.mjs')
`,
        )
      }
      expect(derivedEngineScripts(dir)).toContain('scripts/check-brand-new-engine.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an unreadable resolver source is an ERROR, never an empty engine set', () => {
    // Fail-closed: returning [] for a missing source would silently require nothing, which is the
    // #2335 shape all over again.
    const out = derivedEngineScripts(mkdtempSync(join(tmpdir(), 'arbiter-derive-empty-')))
    expect((out as { error?: string }).error).toBeTruthy()
  })
})

describe('package.json build ships kit runtime data into dist/ (#1575, #1801)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
    files: string[]
    scripts: Record<string, string>
  }

  it('the build script copies the kit catalog + derived + canonical-mapping JSON next to the emitted dist/kit/*.js', () => {
    // tsc emits dist/kit/*.js but NOT the data files the code reads at runtime; the
    // build must co-locate them or `arbiter kit` throws ENOENT in a published install.
    expect(pkg.scripts.build).toMatch(/dist\/kit/)
    expect(pkg.scripts.build).toMatch(/catalog\.json/)
    expect(pkg.scripts.build).toMatch(/derived\.json/)
    expect(pkg.scripts.build).toMatch(/canonical-mapping\.json/)
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

describe('package.json files[] does not ship docs wholesale (#1491, #1801)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { files: string[] }

  it('does NOT ship any part of the docs/ tree (so internal/backup cannot leak by construction)', () => {
    // The human-only docs tree (ADR/REFERENCE/PRODUCT/METHOD/…, ~1.1 MB) lives on the website +
    // repo, not in the npm tarball. The one file the CLI used to read at runtime from docs/
    // (kit-canonical-mapping.json) has moved to src/kit/ — runtime data belongs alongside the
    // other kit runtime data (catalog.json, derived.json), not under docs/ (#1801). Whitelisting
    // beats blacklisting: a new docs subdir can never re-introduce a leak.
    expect(pkg.files).not.toContain('docs')
    expect(pkg.files.filter((f) => f.startsWith('docs/') && !f.startsWith('!'))).toEqual([])
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
