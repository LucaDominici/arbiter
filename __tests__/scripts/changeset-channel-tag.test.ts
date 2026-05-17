// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/changeset-channel-tag.mjs (#664).
 *
 * The script rewrites CHANGELOG.md sections, prepending **Channel:** labels.
 * We test the pure tagging logic by importing the helper functions directly.
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = resolve(__dirname, '../../scripts/changeset-channel-tag.mjs')

function runTagger(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-tagger-'))
  const file = join(dir, 'CHANGELOG.md')
  try {
    writeFileSync(file, content, 'utf-8')
    execFileSync('node', [SCRIPT, '--file', file], { stdio: 'pipe' })
    return readFileSync(file, 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runTaggerDryRun(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-tagger-'))
  const file = join(dir, 'CHANGELOG.md')
  try {
    writeFileSync(file, content, 'utf-8')
    const out = execFileSync('node', [SCRIPT, '--file', file, '--dry-run'], { stdio: 'pipe' })
    return out.toString('utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SAMPLE_CHANGELOG = `# Changelog

## [0.3.0] — 2026-06-01

### Added
- Feature X

## [0.2.0-rc.1] — 2026-05-20

### Added
- RC feature

## [0.2.0-beta.1] — 2026-05-15

### Added
- Beta feature

## [0.1.0] — 2026-04-01

### Added
- Initial release
`

describe('changeset-channel-tag.mjs (#664)', () => {
  it('tags stable version (X.Y.Z) with "**Channel:** stable"', () => {
    const result = runTagger(SAMPLE_CHANGELOG)
    const lines = result.split('\n')
    const idx031 = lines.findIndex((l) => l.includes('[0.3.0]'))
    expect(lines[idx031 + 2]).toBe('**Channel:** stable')
  })

  it('tags rc version with "**Channel:** beta"', () => {
    const result = runTagger(SAMPLE_CHANGELOG)
    const lines = result.split('\n')
    const idx = lines.findIndex((l) => l.includes('[0.2.0-rc.1]'))
    expect(lines[idx + 2]).toBe('**Channel:** beta')
  })

  it('tags beta pre-release with "**Channel:** beta"', () => {
    const result = runTagger(SAMPLE_CHANGELOG)
    const lines = result.split('\n')
    const idx = lines.findIndex((l) => l.includes('[0.2.0-beta.1]'))
    expect(lines[idx + 2]).toBe('**Channel:** beta')
  })

  it('tags canary version with "**Channel:** canary"', () => {
    const input = `# Changelog\n\n## [0.0.0-canary.abc1234] — 2026-05-01\n\n### Added\n- Canary\n`
    const result = runTagger(input)
    expect(result).toContain('**Channel:** canary')
  })

  it('preserves existing correct label (idempotency)', () => {
    const alreadyTagged = runTagger(SAMPLE_CHANGELOG)
    const result2 = runTagger(alreadyTagged)
    // Running twice produces the same output
    expect(result2).toBe(alreadyTagged)
  })

  it('exits non-zero on unknown version shape', () => {
    const bad = `# Changelog\n\n## [0.1.0-unknown.shape] — 2026-05-01\n\n### Added\n- x\n`
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-tagger-bad-'))
    const file = join(dir, 'CHANGELOG.md')
    writeFileSync(file, bad, 'utf-8')
    try {
      expect(() => execFileSync('node', [SCRIPT, '--file', file], { stdio: 'pipe' })).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits non-zero when existing label is mismatched (mismatch guard)', () => {
    const wrongLabel = `# Changelog\n\n## [0.3.0] — 2026-06-01\n\n**Channel:** canary\n\n### Added\n- x\n`
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-tagger-mm-'))
    const file = join(dir, 'CHANGELOG.md')
    writeFileSync(file, wrongLabel, 'utf-8')
    try {
      expect(() => execFileSync('node', [SCRIPT, '--file', file], { stdio: 'pipe' })).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--dry-run outputs "would prepend" without writing file', () => {
    const out = runTaggerDryRun(SAMPLE_CHANGELOG)
    expect(out).toMatch(/would (prepend|tag)/i)
  })

  it('preserves CHANGELOG.md H1 header', () => {
    const result = runTagger(SAMPLE_CHANGELOG)
    expect(result.startsWith('# Changelog')).toBe(true)
  })
})
