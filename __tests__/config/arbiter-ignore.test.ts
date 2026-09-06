// SPDX-License-Identifier: Apache-2.0
// #2353: `.arbiterignore` pattern matching — the ONE selection mechanism shared by
// `arbiter update` and `arbiter diff`. Patterns are gitignore syntax and are matched
// against MANIFEST KEYS (targetDir-relative posix paths — the id under which a
// generated file is tracked in `.arbiter-generated-manifest.json`).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IGNORE_FILE_NAME,
  loadIgnorePatterns,
  isIgnored,
  matchesOnly,
  buildSelectionPredicate,
} from '../../src/config/arbiter-ignore.js'

describe('#2353 loadIgnorePatterns', () => {
  it('returns [] when no .arbiterignore exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-ignore-'))
    try {
      expect(loadIgnorePatterns(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops blank lines and # comments, trims the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-ignore-'))
    try {
      writeFileSync(
        join(dir, IGNORE_FILE_NAME),
        [
          '# own CI numbering scheme',
          '',
          '  .github/workflows/**  ',
          'docs/',
          '!docs/INDEX.md',
        ].join('\n'),
      )
      expect(loadIgnorePatterns(dir)).toEqual(['.github/workflows/**', 'docs/', '!docs/INDEX.md'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('#2353 isIgnored — gitignore semantics over manifest keys', () => {
  it('matches an exact managed-file path', () => {
    expect(isIgnored(['.github/labels.yml'], '.github/labels.yml')).toBe(true)
    expect(isIgnored(['.github/labels.yml'], '.github/other.yml')).toBe(false)
  })

  it('matches a bare token at ANY depth (unanchored, like gitignore)', () => {
    expect(isIgnored(['AGENTS.md'], 'AGENTS.md')).toBe(true)
    expect(isIgnored(['AGENTS.md'], 'docs/internal/AGENTS.md')).toBe(true)
  })

  it('anchors a pattern that starts with /', () => {
    expect(isIgnored(['/AGENTS.md'], 'AGENTS.md')).toBe(true)
    expect(isIgnored(['/AGENTS.md'], 'docs/AGENTS.md')).toBe(false)
  })

  it('treats a trailing / as directory-only', () => {
    expect(isIgnored(['docs/'], 'docs/METHOD/x.md')).toBe(true)
    expect(isIgnored(['docs/'], 'docs')).toBe(false)
  })

  it('a directory-shaped token also covers everything under it', () => {
    expect(isIgnored(['scripts'], 'scripts/check-all.mjs')).toBe(true)
    expect(isIgnored(['scripts'], 'scripts')).toBe(true)
  })

  it('supports * and ** globs', () => {
    expect(isIgnored(['.github/workflows/*.yml'], '.github/workflows/01-ci.yml')).toBe(true)
    expect(isIgnored(['.github/workflows/*.yml'], '.github/workflows/nested/01-ci.yml')).toBe(false)
    expect(isIgnored(['.github/workflows/**'], '.github/workflows/nested/01-ci.yml')).toBe(true)
  })

  it('negates with ! and lets the LAST matching pattern win', () => {
    const patterns = ['scripts/**', '!scripts/check-all.mjs']
    expect(isIgnored(patterns, 'scripts/check-no-pii.mjs')).toBe(true)
    expect(isIgnored(patterns, 'scripts/check-all.mjs')).toBe(false)
    // Order matters: re-ignoring after the negation wins again.
    expect(isIgnored([...patterns, 'scripts/check-all.mjs'], 'scripts/check-all.mjs')).toBe(true)
  })

  it('is inert with no patterns', () => {
    expect(isIgnored([], 'anything/at/all.md')).toBe(false)
  })
})

describe('#2353 matchesOnly — the --only allowlist', () => {
  it('matches an exact path or a glob', () => {
    expect(matchesOnly(['.github/labels.yml'], '.github/labels.yml')).toBe(true)
    expect(matchesOnly(['.claude/hooks/*.mjs'], '.claude/hooks/check-no-pii.mjs')).toBe(true)
    expect(matchesOnly(['.github/labels.yml'], 'AGENTS.md')).toBe(false)
  })
})

describe('#2353 buildSelectionPredicate', () => {
  it('emits everything when neither mechanism is configured', () => {
    const select = buildSelectionPredicate({ patterns: [], only: [] })
    expect(select('AGENTS.md')).toBe('emit')
  })

  it('reports an ignored key as ignored', () => {
    const select = buildSelectionPredicate({ patterns: ['docs/'], only: [] })
    expect(select('docs/x.md')).toBe('ignored')
    expect(select('AGENTS.md')).toBe('emit')
  })

  it('deselects everything outside --only', () => {
    const select = buildSelectionPredicate({ patterns: [], only: ['.github/labels.yml'] })
    expect(select('.github/labels.yml')).toBe('emit')
    expect(select('AGENTS.md')).toBe('deselected')
  })

  it('ignore WINS over a conflicting --only', () => {
    const select = buildSelectionPredicate({
      patterns: ['.github/labels.yml'],
      only: ['.github/labels.yml'],
    })
    expect(select('.github/labels.yml')).toBe('ignored')
  })
})
