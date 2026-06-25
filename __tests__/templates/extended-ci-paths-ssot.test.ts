import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

/**
 * Port C2 (#1497) — sensitive-path SSOT → conditional extended gate.
 *
 * One version-controlled regex list (`.github/extended-ci-paths.txt`) drives the
 * 02-pr-extended `check-trigger` job: the slow suites run only when LOC >= a
 * parameterized threshold, a sensitive path matched, or an `extended-ci` label
 * is present. This proves the SSOT is emitted, is consumable by `grep -E -f`,
 * and carries only neutral (non-proprietary) example patterns.
 */
function renderSsot(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/extended-ci-paths.txt.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('extended-ci-paths SSOT — emission', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ssot-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generateGithub emits .github/extended-ci-paths.txt', () => {
    const result = generateGithub(makeConfig(dir))
    expect(result.files.some((f) => f.path.includes('extended-ci-paths.txt'))).toBe(true)
    expect(existsSync(join(dir, '.github', 'extended-ci-paths.txt'))).toBe(true)
  })

  it('SSOT documents the parameterized threshold variable', () => {
    const content = renderSsot()
    expect(content).toContain('EXTENDED_CI_LOC_THRESHOLD')
  })
})

describe('extended-ci-paths SSOT — content is grep -E -f consumable', () => {
  it('carries neutral example patterns (no proprietary identifiers)', () => {
    const content = renderSsot()
    for (const pat of ['^migrations/', '(^|/)security/', 'Dockerfile', '.github/workflows/']) {
      expect(content).toContain(pat)
    }
  })

  it('every non-comment, non-blank line is a usable extended regex', () => {
    const content = renderSsot()
    const lines = content.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Must compile as a regex; if any line throws the SSOT is unusable.
      expect(() => new RegExp(line)).not.toThrow()
    }
  })

  it('a non-sensitive source path does NOT match any SSOT pattern (skip extended)', () => {
    const content = renderSsot()
    const patterns = content
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
      .map((l) => new RegExp(l))
    const changed = 'src/widgets/button.ts'
    expect(patterns.some((re) => re.test(changed))).toBe(false)
  })

  it('a sensitive path DOES match an SSOT pattern (run extended)', () => {
    const content = renderSsot()
    const patterns = content
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
      .map((l) => new RegExp(l))
    for (const changed of ['migrations/001_init.sql', '.github/workflows/01-pr-fast.yml']) {
      expect(patterns.some((re) => re.test(changed))).toBe(true)
    }
  })
})
