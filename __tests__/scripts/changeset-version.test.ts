// SPDX-License-Identifier: Apache-2.0
// #1478 — root-aware `changeset version` wrapper + the channel-tag / sync-changelog fixes that make
// the documented release flow actually consumable.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  withoutWorkspaces,
  withWorkspaces,
  versionWithRoot,
} from '../../scripts/changeset-version.mjs'

const CHANNEL = resolve('scripts/changeset-channel-tag.mjs')
const SYNC = resolve('scripts/sync-changelog.mjs')

function temp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'release-tooling-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('changeset-version wrapper (#1478 root enumeration)', () => {
  it('withoutWorkspaces drops the key but preserves order of the rest', () => {
    const pkg = { name: 'x', version: '1.0.0', workspaces: ['website'], scripts: {} }
    const out = withoutWorkspaces(pkg)
    expect('workspaces' in out).toBe(false)
    expect(Object.keys(out)).toEqual(['name', 'version', 'scripts'])
  })

  it('withWorkspaces re-inserts the key right after its original predecessor', () => {
    const versioned = { name: 'x', version: '1.1.0', scripts: {} }
    const out = withWorkspaces(versioned, ['website'], 'version')
    expect(Object.keys(out)).toEqual(['name', 'version', 'workspaces', 'scripts'])
    expect(out.workspaces).toEqual(['website'])
  })

  it('strips workspaces during the version step and restores it after (preserving the bump)', () => {
    const t = temp()
    try {
      const pkgPath = join(t.dir, 'package.json')
      writeFileSync(
        pkgPath,
        JSON.stringify(
          { name: '@arbiter/cli', version: '0.2.0', workspaces: ['website'] },
          null,
          2,
        ),
      )
      let sawWorkspacesDuringRun: boolean | null = null
      versionWithRoot({
        pkgPath,
        runChangeset: () => {
          // changeset version sees NO workspaces (so it bumps the root)…
          const mid = JSON.parse(readFileSync(pkgPath, 'utf-8'))
          sawWorkspacesDuringRun = 'workspaces' in mid
          // …and rewrites the version, as the real tool would.
          writeFileSync(pkgPath, JSON.stringify({ ...mid, version: '0.3.0' }, null, 2))
        },
      })
      expect(sawWorkspacesDuringRun).toBe(false)
      const after = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      expect(after.version).toBe('0.3.0') // bump preserved
      expect(after.workspaces).toEqual(['website']) // restored
    } finally {
      t.cleanup()
    }
  })

  it('restores workspaces even when the version step throws (try/finally)', () => {
    const t = temp()
    try {
      const pkgPath = join(t.dir, 'package.json')
      writeFileSync(
        pkgPath,
        JSON.stringify(
          { name: '@arbiter/cli', version: '0.2.0', workspaces: ['website'] },
          null,
          2,
        ),
      )
      expect(() =>
        versionWithRoot({
          pkgPath,
          runChangeset: () => {
            throw new Error('changeset boom')
          },
        }),
      ).toThrow('changeset boom')
      const after = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      expect(after.workspaces).toEqual(['website'])
    } finally {
      t.cleanup()
    }
  })
})

describe('changeset-channel-tag (#1478 header formats + Unreleased)', () => {
  function run(file: string): { status: number; stderr: string } {
    const r = spawnSync('node', [CHANNEL, '--file', file], { encoding: 'utf-8' })
    return { status: r.status ?? 1, stderr: r.stderr ?? '' }
  }
  it('labels a PLAIN changeset header (## X.Y.Z) and skips [Unreleased] without erroring', () => {
    const t = temp()
    try {
      const f = join(t.dir, 'CHANGELOG.md')
      writeFileSync(f, '# Changelog\n\n## [Unreleased]\n\n_Nothing._\n\n## 0.3.0\n\n- thing\n')
      expect(run(f).status).toBe(0)
      const out = readFileSync(f, 'utf-8')
      expect(out).toContain('## 0.3.0\n\n**Channel:** stable')
      expect(out).toContain('## [Unreleased]') // untouched, not labelled
    } finally {
      t.cleanup()
    }
  })
  it('still errors (exit 1) on a genuinely malformed bracketed version', () => {
    const t = temp()
    try {
      const f = join(t.dir, 'CHANGELOG.md')
      writeFileSync(f, '## [not-a-version]\n\n- x\n')
      expect(run(f).status).toBe(1)
    } finally {
      t.cleanup()
    }
  })
})

describe('sync-changelog (#1478 frontmatter preservation)', () => {
  it('preserves the existing target frontmatter instead of clobbering it with a title stub', () => {
    const t = temp()
    try {
      const changelog = join(t.dir, 'CHANGELOG.md')
      const out = join(t.dir, 'stable.md')
      writeFileSync(changelog, '# Changelog\n\n## [0.3.0]\n\n**Channel:** stable\n\n- thing\n')
      writeFileSync(
        out,
        '---\ntitle: Stable Releases\ndoc_version: 2\nstatus: active\nlast_review: 2026-06-21\n---\n\nold body\n',
      )
      const r = spawnSync('node', [SYNC, '--changelog', changelog, '--out', out], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      const written = readFileSync(out, 'utf-8')
      expect(written).toContain('doc_version: 2')
      expect(written).toContain('status: active')
      expect(written).toContain('last_review: 2026-06-21')
      expect(written).toContain('## [0.3.0]')
    } finally {
      t.cleanup()
    }
  })
})
