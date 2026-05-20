// SPDX-License-Identifier: Apache-2.0
// Test guard for #968 — docs/METHOD/PATTERNS_CATALOG.md structure.
// Pure node:fs only (no spawn / no exec) per INV-12 / CANON-12.
// Paths anchored to repo root via import.meta.url — independent of process.cwd().

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const r = (rel: string) => resolve(ROOT, rel)
const DOC_PATH = r('docs/METHOD/PATTERNS_CATALOG.md')

const REQUIRED_LABELS = [
  '**Use when:**',
  '**Avoid when:**',
  '**Registry path:**',
  '**Variation axis:**',
  '**Test approach:**',
  '**Rejected alternatives:**',
] as const

const MAX_ENTRIES = 12
const MIN_ENTRIES = 1

function readDoc(): string {
  expect(existsSync(DOC_PATH), `PATTERNS_CATALOG.md not found at ${DOC_PATH}`).toBe(true)
  return readFileSync(DOC_PATH, 'utf8')
}

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  return end === -1 ? null : content.slice(4, end)
}

interface Entry {
  name: string
  block: string
}

function extractEntries(content: string): Entry[] {
  // Skip the frontmatter so it doesn't get split with the body.
  const fmEnd = content.indexOf('\n---\n', 4)
  const body = fmEnd === -1 ? content : content.slice(fmEnd + 5)

  // Each entry starts at "## <number>. <name>"
  const headingRegex = /^## (\d+)\.\s+(.+?)\s*$/gm
  const matches: { index: number; num: number; name: string }[] = []
  let m: RegExpExecArray | null
  while ((m = headingRegex.exec(body)) !== null) {
    matches.push({ index: m.index, num: Number(m[1]), name: m[2] })
  }

  const entries: Entry[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length
    entries.push({ name: matches[i].name, block: body.slice(start, end) })
  }
  return entries
}

function extractRegistryPath(block: string): string | null {
  const m = block.match(/\*\*Registry path:\*\*\s+`([^`]+)`/)
  return m ? m[1] : null
}

describe('docs/METHOD/PATTERNS_CATALOG.md structure (#968)', () => {
  it('the catalog file exists at docs/METHOD/PATTERNS_CATALOG.md', () => {
    expect(existsSync(DOC_PATH)).toBe(true)
  })

  it('has a YAML frontmatter block with canonical_id PATTERNS_CATALOG', () => {
    const content = readDoc()
    const fm = extractFrontmatter(content)
    expect(fm, 'frontmatter block missing').not.toBeNull()
    expect(fm!).toMatch(/canonical_id:\s*'PATTERNS_CATALOG'/)
    expect(fm!).toMatch(/title:\s*'arbiter Patterns Catalog'/)
  })

  it(`has between ${MIN_ENTRIES} and ${MAX_ENTRIES} pattern entries`, () => {
    const entries = extractEntries(readDoc())
    expect(entries.length).toBeGreaterThanOrEqual(MIN_ENTRIES)
    expect(entries.length).toBeLessThanOrEqual(MAX_ENTRIES)
  })

  it('every entry has all six required schema labels', () => {
    const entries = extractEntries(readDoc())
    for (const entry of entries) {
      for (const label of REQUIRED_LABELS) {
        expect(entry.block.includes(label), `entry "${entry.name}" is missing label ${label}`).toBe(
          true,
        )
      }
    }
  })

  it('every Registry path is a literal existing directory (no globs)', () => {
    const entries = extractEntries(readDoc())
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const regPath = extractRegistryPath(entry.block)
      expect(regPath, `entry "${entry.name}" has no Registry path`).not.toBeNull()
      // Disallow glob characters in registry paths
      expect(
        /[*?[\]]/.test(regPath!),
        `entry "${entry.name}" Registry path "${regPath}" contains glob characters`,
      ).toBe(false)
      const abs = r(regPath!.replace(/\/$/, ''))
      expect(
        existsSync(abs),
        `entry "${entry.name}" Registry path "${regPath}" does not exist`,
      ).toBe(true)
      expect(
        statSync(abs).isDirectory(),
        `entry "${entry.name}" Registry path "${regPath}" is not a directory`,
      ).toBe(true)
    }
  })
})
