// SPDX-License-Identifier: Apache-2.0
// #1218: verify docs/STRUCTURE-AUDIT.md exists with expected content
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const DOC = join(process.cwd(), 'docs', 'STRUCTURE-AUDIT.md')

describe('docs/STRUCTURE-AUDIT.md (#1218)', () => {
  it('exists', () => {
    expect(existsSync(DOC)).toBe(true)
  })

  it('has valid frontmatter title', () => {
    const content = readFileSync(DOC, 'utf-8')
    expect(content).toContain("title: 'Docs Structure Audit'")
    expect(content).toContain('status: active')
  })

  it('characterizes all major top-level folders', () => {
    const content = readFileSync(DOC, 'utf-8')
    for (const folder of [
      'docs/ADR/',
      'docs/REFERENCE/',
      'docs/METHOD/',
      'docs/SYSTEM/',
      'docs/PRODUCT/',
      'docs/GOVERNANCE/',
    ]) {
      expect(content, `missing folder ${folder}`).toContain(folder)
    }
  })

  it('contains all required sections', () => {
    const content = readFileSync(DOC, 'utf-8')
    expect(content).toContain('## 1. Inventory Summary')
    expect(content).toContain('## 2. Per-Folder Characterization')
    expect(content).toContain('## 3. Generated vs Hand-Written')
    expect(content).toContain('## 4. Reachability and Orphans')
    expect(content).toContain('## 5. Duplication and Overlap Clusters')
    expect(content).toContain('## 6. Consolidation Candidates Summary')
    expect(content).toContain('## 7. Go/No-Go Scaffold')
  })

  it('reports zero strict orphans', () => {
    const content = readFileSync(DOC, 'utf-8')
    expect(content).toContain('Strict orphans')
    expect(content).toContain('**Zero.**')
  })
})
