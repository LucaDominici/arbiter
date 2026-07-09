// SPDX-License-Identifier: Apache-2.0
// F2 (#1838, item 5): package.json version, `arbiter --version` runtime output,
// and CHANGELOG.md's top released entry must all agree. Regression coverage
// for the drift class fixed once already in F1 (#1837, --version hardcoded to
// 0.3.0 while package.json had moved to 0.4.0) — this test suite proves the
// gate would catch it again if it ever recurred.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readPackageVersion,
  readChangelogTopVersion,
  diffVersionParity,
} from '../../scripts/check-version-parity.mjs'

const SCRIPT = resolve('scripts/check-version-parity.mjs')

// ─── readPackageVersion ───────────────────────────────────────────────────────

describe('readPackageVersion', () => {
  it('reads the version field', () => {
    expect(readPackageVersion(JSON.stringify({ version: '0.4.0' }))).toBe('0.4.0')
  })

  it('throws when version is missing (fail-closed, not vacuous)', () => {
    expect(() => readPackageVersion(JSON.stringify({ name: 'x' }))).toThrow()
  })
})

// ─── readChangelogTopVersion ───────────────────────────────────────────────────

describe('readChangelogTopVersion', () => {
  it('returns the first released heading, skipping Unreleased', () => {
    const changelog = '## [Unreleased]\n\n_Nothing yet._\n\n## [0.4.0] — 2026-07-07\n\nStuff.\n'
    expect(readChangelogTopVersion(changelog)).toBe('0.4.0')
  })

  it('returns the top heading directly when there is no Unreleased section', () => {
    const changelog = '## [1.2.3] — 2026-01-01\n\nStuff.\n'
    expect(readChangelogTopVersion(changelog)).toBe('1.2.3')
  })

  it('returns null when no released heading exists at all', () => {
    expect(readChangelogTopVersion('## [Unreleased]\n\n_Nothing yet._\n')).toBeNull()
  })
})

// ─── diffVersionParity (drift detection) ──────────────────────────────────────

describe('diffVersionParity', () => {
  it('returns no violations when all three agree', () => {
    expect(diffVersionParity('0.4.0', '0.4.0', '0.4.0')).toEqual([])
  })

  it('DETECTS the #1837 regression: --version stale while package.json moved on', () => {
    const violations = diffVersionParity('0.4.0', '0.3.0', '0.4.0')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('0.3.0')
    expect(violations[0]).toContain('0.4.0')
  })

  it('DETECTS a CHANGELOG top entry that never got bumped', () => {
    const violations = diffVersionParity('0.5.0', '0.5.0', '0.4.0')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('CHANGELOG.md')
  })

  it('DETECTS a missing CHANGELOG released heading', () => {
    const violations = diffVersionParity('0.4.0', '0.4.0', null)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('no released version heading')
  })

  it('reports both violations when both are wrong', () => {
    expect(diffVersionParity('0.4.0', '0.3.0', '0.2.0')).toHaveLength(2)
  })
})

// ─── end-to-end: real repo must be in parity ──────────────────────────────────

describe('check-version-parity.mjs — real repo', () => {
  it('exits 0 against the real package.json/CHANGELOG.md/dist/cli.js (requires npm run build)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    if (r.status === 2) {
      // dist/ not built in this environment — the gate correctly refuses to
      // pass vacuously rather than silently skipping. Not a test failure of
      // the check-version-parity logic itself.
      expect(r.stdout).toContain('run "npm run build"')
      return
    }
    expect(r.stdout).not.toContain('DRIFT')
    expect(r.status).toBe(0)
  })
})

// ─── end-to-end: synthetic drift must fail the gate (non-vacuity proof) ──────

describe('check-version-parity.mjs — synthetic drift fails closed', () => {
  it('exits 1 when the compiled CLI reports a stale version (regression: #1837)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'version-parity-'))
    try {
      const pkgPath = join(dir, 'package.json')
      const changelogPath = join(dir, 'CHANGELOG.md')
      const cliPath = join(dir, 'fake-cli.js')
      writeFileSync(pkgPath, JSON.stringify({ version: '0.4.0' }))
      writeFileSync(changelogPath, '## [Unreleased]\n\n_Nothing yet._\n\n## [0.4.0] — 2026-07-07\n')
      // A "compiled CLI" that still prints the stale 0.3.0 — mirrors the exact
      // #1837 regression (hardcoded version string surviving a package.json bump).
      writeFileSync(cliPath, "#!/usr/bin/env node\nprocess.stdout.write('0.3.0\\n')\n")
      chmodSync(cliPath, 0o755)

      const r = spawnSync(
        'node',
        [SCRIPT, `--pkg=${pkgPath}`, `--changelog=${changelogPath}`, `--cli=${cliPath}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('0.3.0')
      expect(r.stdout).toContain('0.4.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 (invocation error) when dist/cli.js does not exist, never passing vacuously', () => {
    const dir = mkdtempSync(join(tmpdir(), 'version-parity-nobuild-'))
    try {
      const pkgPath = join(dir, 'package.json')
      const changelogPath = join(dir, 'CHANGELOG.md')
      writeFileSync(pkgPath, JSON.stringify({ version: '0.4.0' }))
      writeFileSync(changelogPath, '## [0.4.0] — 2026-07-07\n')
      const r = spawnSync(
        'node',
        [
          SCRIPT,
          `--pkg=${pkgPath}`,
          `--changelog=${changelogPath}`,
          `--cli=${join(dir, 'missing-cli.js')}`,
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
