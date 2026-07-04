// SPDX-License-Identifier: Apache-2.0
// TDD gate test for #1240: ADR-089 + PRD-DOCS-EVOLUTION commit
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const ADR_089 = join(
  root,
  'docs',
  'internal',
  'ADR',
  '089-collapse-hand-docs-to-ssot-core-plus-generated-wiki.md',
)
const ADR_README = join(root, 'docs', 'internal', 'ADR', 'README.md')
const PRD_FILE = join(root, 'docs', 'internal', 'PRODUCT', 'PRD-DOCS-EVOLUTION.md')

function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  if (m === null) return {}
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fm[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return fm
}

describe('ADR-089 presence and correctness (#1240)', () => {
  it('ADR-089 file exists', () => {
    expect(existsSync(ADR_089)).toBe(true)
  })

  it('ADR-089 has canonical_id = 089', () => {
    const content = readFileSync(ADR_089, 'utf-8')
    const fm = parseFrontmatter(content)
    expect(fm['canonical_id']).toBe('089')
  })

  it('ADR-089 has status = active', () => {
    const content = readFileSync(ADR_089, 'utf-8')
    const fm = parseFrontmatter(content)
    expect(fm['status']).toBe('active')
  })

  it('ADR-089 README.md entry exists', () => {
    const readme = readFileSync(ADR_README, 'utf-8')
    expect(readme).toContain('089-collapse-hand-docs')
  })
})

describe('PRD-DOCS-EVOLUTION presence and correctness (#1240)', () => {
  it('PRD-DOCS-EVOLUTION.md exists', () => {
    expect(existsSync(PRD_FILE)).toBe(true)
  })

  it('PRD has required frontmatter keys', () => {
    const content = readFileSync(PRD_FILE, 'utf-8')
    const fm = parseFrontmatter(content)
    for (const key of [
      'title',
      'doc_version',
      'status',
      'last_review',
      'owner',
      'canonical_id',
      'tags',
    ]) {
      expect(fm, `missing key ${key}`).toHaveProperty(key)
    }
  })
})
