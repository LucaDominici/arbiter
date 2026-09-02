// SPDX-License-Identifier: Apache-2.0
//
// #2450 — `docs/REFERENCE/backward-compat-harness.md`'s "Current fixture inventory"
// table is prose, hand-maintained separately from
// `__tests__/fixtures/compat/MANIFEST.json` (the machine-readable source of truth
// the same doc names). Nothing kept them in sync: the table drifted to list only
// one of the harness's two registered fixtures.
//
// This test asserts the RELATIONSHIP — every MANIFEST entry has exactly one
// matching table row, and vice versa — so it stays correct as fixtures are added
// or removed, rather than pinning today's fixture count or names.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const DOC_PATH = join(REPO_ROOT, 'docs/REFERENCE/backward-compat-harness.md')
const MANIFEST_PATH = join(REPO_ROOT, '__tests__/fixtures/compat/MANIFEST.json')
const COMPAT_DIR = join(REPO_ROOT, '__tests__/fixtures/compat')

interface ManifestEntry {
  version: string
  archetype: string
  language: string
  path: string
  note?: string
}

/** Rows of the "Current fixture inventory" markdown table, keyed by their Path cell. */
function inventoryTableRows(
  body: string,
): { version: string; archetype: string; language: string; path: string }[] {
  const heading = /^#+\s+Current fixture inventory\s*$/
  const lines = body.split('\n')
  const start = lines.findIndex((l) => heading.test(l))
  if (start === -1) return []
  const rows: { version: string; archetype: string; language: string; path: string }[] = []
  let seenSeparator = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.trimStart().startsWith('|')) {
      if (rows.length > 0 || seenSeparator) break
      continue // blank lines / prose between the heading and the table
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.every((c) => /^[\s:-]+$/.test(c))) {
      seenSeparator = true
      continue
    }
    if (!seenSeparator) continue // header row (column titles) — not a data row
    const [version, archetype, language, path] = cells
    if (
      version !== undefined &&
      archetype !== undefined &&
      language !== undefined &&
      path !== undefined
    ) {
      rows.push({ version, archetype, language, path })
    }
  }
  return rows
}

/** Real fixture directories on disk under __tests__/fixtures/compat/ (one arbiter.json each). */
function fixtureDirsOnDisk(): string[] {
  return readdirSync(COMPAT_DIR).filter((name) => statSync(join(COMPAT_DIR, name)).isDirectory())
}

describe('#2450 — backward-compat-harness.md fixture inventory matches MANIFEST.json', () => {
  const manifest: ManifestEntry[] = JSON.parse(
    readFileSync(MANIFEST_PATH, 'utf-8'),
  ) as ManifestEntry[]
  const doc = readFileSync(DOC_PATH, 'utf-8')
  const rows = inventoryTableRows(doc)

  it('the doc has a non-empty "Current fixture inventory" table', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  it('every MANIFEST.json entry has a matching table row (same version/archetype/language/path)', () => {
    const missing = manifest.filter(
      (entry) =>
        !rows.some(
          (row) =>
            row.version === entry.version &&
            row.archetype === entry.archetype &&
            row.language === entry.language &&
            row.path === entry.path,
        ),
    )
    expect(missing).toEqual([])
  })

  it('every table row corresponds to a real MANIFEST.json entry (no stale/invented rows)', () => {
    const stale = rows.filter(
      (row) =>
        !manifest.some(
          (entry) =>
            entry.version === row.version &&
            entry.archetype === row.archetype &&
            entry.language === row.language &&
            entry.path === row.path,
        ),
    )
    expect(stale).toEqual([])
  })

  it('the table has exactly as many rows as MANIFEST.json has entries', () => {
    expect(rows.length).toBe(manifest.length)
  })

  it('every fixture directory on disk is either MANIFEST-registered or explicitly documented as excluded', () => {
    const registeredPaths = new Set(manifest.map((e) => e.path))
    const unaccounted = fixtureDirsOnDisk().filter(
      (dirName) => !registeredPaths.has(dirName) && !doc.includes(dirName),
    )
    expect(unaccounted).toEqual([])
  })
})
