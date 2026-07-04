// SPDX-License-Identifier: Apache-2.0
// Tests for #1228 (workflow-pr-fast reference) and #1233 (ADR-090 perf budget)
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function readDoc(relPath: string): string {
  const full = join(ROOT, relPath)
  if (!existsSync(full)) throw new Error(`doc not found: ${relPath}`)
  return readFileSync(full, 'utf-8')
}

describe('workflow-pr-fast reference (#1228)', () => {
  it('docs/REFERENCE/workflow-pr-fast.md exists', () => {
    expect(existsSync(join(ROOT, 'docs/REFERENCE/workflow-pr-fast.md'))).toBe(true)
  })

  it('has required frontmatter fields', () => {
    const content = readDoc('docs/REFERENCE/workflow-pr-fast.md')
    expect(content).toMatch(/^---/m)
    expect(content).toMatch(/title:/m)
    expect(content).toMatch(/status:\s*active/m)
    expect(content).toMatch(/kind\/reference/m)
  })

  it('EJS template 01-pr-fast.yml.ejs cross-links to this reference', () => {
    const ejs = readDoc('src/templates/github/workflows/01-pr-fast.yml.ejs')
    expect(ejs).toContain('docs/REFERENCE/workflow-pr-fast.md')
  })
})

describe('ADR-090 workflow performance budget (#1233)', () => {
  it('docs/internal/ADR/090-workflow-performance-budget.md exists', () => {
    expect(existsSync(join(ROOT, 'docs/internal/ADR/090-workflow-performance-budget.md'))).toBe(
      true,
    )
  })

  it('has required frontmatter fields', () => {
    const content = readDoc('docs/internal/ADR/090-workflow-performance-budget.md')
    expect(content).toMatch(/^---/m)
    expect(content).toMatch(/canonical_id:\s*['"]?090['"]?/m)
    expect(content).toMatch(/status:\s*active/m)
    expect(content).toMatch(/kind\/adr/m)
  })

  it('documents PR Fast performance budget', () => {
    const content = readDoc('docs/internal/ADR/090-workflow-performance-budget.md')
    expect(content).toMatch(/15\s*min/i)
    expect(content).toMatch(/PR\s*Fast/i)
  })
})
