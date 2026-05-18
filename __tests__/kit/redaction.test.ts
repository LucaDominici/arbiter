// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scanForRedactedTokens, type LexiconEntry } from '../../src/kit/redaction.js'

const ROOT = resolve(__dirname, '../..')

const LEXICON: LexiconEntry[] = JSON.parse(
  readFileSync(join(ROOT, 'scripts/data/redaction-lexicon.json'), 'utf-8'),
)

// ─── Positive: each lexicon token must be caught ─────────────────────────────

describe('scanForRedactedTokens — positive per-token', () => {
  for (const entry of LEXICON) {
    it(`detects "${entry.token}"`, () => {
      const matches = scanForRedactedTokens(`some text with ${entry.token} here`, LEXICON)
      expect(matches.some((m) => m.token === entry.token)).toBe(true)
    })
  }
})

// ─── allowContext branch ──────────────────────────────────────────────────────

describe('scanForRedactedTokens — allowContext', () => {
  it('passes Keycloak when line contains allowContext', () => {
    const matches = scanForRedactedTokens('Use a Keycloak-compatible IdP for auth', LEXICON)
    expect(matches.some((m) => m.token === 'Keycloak')).toBe(false)
  })

  it('catches bare Keycloak without allowContext', () => {
    const matches = scanForRedactedTokens('Configured with Keycloak directly', LEXICON)
    expect(matches.some((m) => m.token === 'Keycloak')).toBe(true)
  })
})

// ─── Negative: clean text ─────────────────────────────────────────────────────

describe('scanForRedactedTokens — negative', () => {
  it('returns empty for clean text', () => {
    const matches = scanForRedactedTokens('No forbidden tokens here.', LEXICON)
    expect(matches).toHaveLength(0)
  })

  it('reports correct line numbers', () => {
    const text = 'clean line\nplanning-service lives here\nclean again'
    const matches = scanForRedactedTokens(text, LEXICON)
    expect(matches).toHaveLength(1)
    expect(matches[0].line).toBe(2)
    expect(matches[0].token).toBe('planning-service')
  })
})

// ─── Multi-match: multiple tokens on same line ────────────────────────────────

describe('scanForRedactedTokens — multiple tokens', () => {
  it('reports each token separately', () => {
    const text = 'cloud.ms5.core is at planning-service'
    const matches = scanForRedactedTokens(text, LEXICON)
    const tokens = matches.map((m) => m.token)
    expect(tokens).toContain('cloud.ms5.core')
    expect(tokens).toContain('planning-service')
    // ms5 is a substring of cloud.ms5.core — both match independently
    expect(tokens).toContain('ms5')
  })
})

// ─── Real-data scan: committed kit + docs + .github files ────────────────────

function collectFiles(dir: string, ext: string[]): string[] {
  const results: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, ext))
    } else if (ext.some((e) => full.endsWith(e))) {
      results.push(full)
    }
  }
  return results
}

describe('scanForRedactedTokens — real committed files', () => {
  // Scope to kit-authored files only — pre-existing docs are not in scope for
  // this PR's redaction gate (they predate the lexicon).
  const scanDirs = [join(ROOT, 'src/kit'), join(ROOT, '.github/ISSUE_TEMPLATE')]
  const exts = ['.ts', '.js', '.json', '.md', '.yaml', '.yml', '.ejs']
  const skip = new Set([join(ROOT, 'scripts/data/redaction-lexicon.json')])

  const files = scanDirs.flatMap((d) => collectFiles(d, exts)).filter((f) => !skip.has(f))

  if (files.length === 0) {
    it.skip('no committed kit/docs/.github files yet', () => {})
    return
  }

  for (const file of files) {
    it(`${file.replace(ROOT + '/', '')} is clean`, () => {
      const text = readFileSync(file, 'utf-8')
      const matches = scanForRedactedTokens(text, LEXICON)
      if (matches.length > 0) {
        const detail = matches
          .map((m) => `  line ${m.line} [${m.token}]: ${m.lineContent.trim()}`)
          .join('\n')
        throw new Error(`Forbidden tokens found in ${file}:\n${detail}`)
      }
      expect(matches).toHaveLength(0)
    })
  }
})
