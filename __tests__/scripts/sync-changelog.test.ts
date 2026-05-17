// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/sync-changelog.mjs (#664).
 *
 * The script reads root CHANGELOG.md, strips the H1, prepends VitePress
 * frontmatter, filters to stable entries, and writes website/changelog/stable.md.
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = resolve(__dirname, '../../scripts/sync-changelog.mjs')

const SAMPLE_TAGGED_CHANGELOG = `# Changelog

## [0.3.0] — 2026-06-01

**Channel:** stable

### Added
- Stable feature

## [0.2.0-rc.1] — 2026-05-20

**Channel:** beta

### Added
- RC feature

## [0.1.0] — 2026-04-01

### Added
- Legacy stable (no channel tag)
`

function runSync(changelogContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-sync-'))
  const changelogPath = join(dir, 'CHANGELOG.md')
  const outDir = join(dir, 'website', 'changelog')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'stable.md')
  try {
    writeFileSync(changelogPath, changelogContent, 'utf-8')
    execFileSync('node', [SCRIPT, '--changelog', changelogPath, '--out', outPath], {
      stdio: 'pipe',
    })
    return readFileSync(outPath, 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('sync-changelog.mjs (#664)', () => {
  it('output starts with VitePress frontmatter', () => {
    const result = runSync(SAMPLE_TAGGED_CHANGELOG)
    expect(result.startsWith('---\n')).toBe(true)
    expect(result).toContain('title: Stable Releases')
  })

  it('strips leading "# Changelog" H1 from output', () => {
    const result = runSync(SAMPLE_TAGGED_CHANGELOG)
    expect(result).not.toContain('# Changelog')
  })

  it('keeps stable entries (tagged or legacy untagged)', () => {
    const result = runSync(SAMPLE_TAGGED_CHANGELOG)
    expect(result).toContain('[0.3.0]')
    expect(result).toContain('[0.1.0]')
  })

  it('excludes beta entries', () => {
    const result = runSync(SAMPLE_TAGGED_CHANGELOG)
    expect(result).not.toContain('[0.2.0-rc.1]')
  })

  it('excludes canary entries', () => {
    const input =
      SAMPLE_TAGGED_CHANGELOG +
      `\n## [0.0.0-canary.abc1234] — 2026-05-01\n\n**Channel:** canary\n\n### Added\n- Canary\n`
    const result = runSync(input)
    expect(result).not.toContain('canary.abc1234')
  })

  it('exits non-zero if CHANGELOG.md not found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-sync-missing-'))
    const outDir = join(dir, 'out')
    mkdirSync(outDir, { recursive: true })
    try {
      expect(() =>
        execFileSync(
          'node',
          [SCRIPT, '--changelog', join(dir, 'NONEXISTENT.md'), '--out', join(outDir, 'stable.md')],
          { stdio: 'pipe' },
        ),
      ).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
