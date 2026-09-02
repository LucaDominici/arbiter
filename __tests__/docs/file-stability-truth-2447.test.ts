// SPDX-License-Identifier: Apache-2.0
// #2447 — docs(file-stability): the AGENTS.md custom-marker merge promise has no
// implementation anywhere in src/ (verified: `grep -r "arbiter:custom:start" src/`
// returns nothing but the doc itself), and `.claude/knowledge-map.json` has no File
// Map row at all. This test pins the doc to the ACTUAL mechanism
// (src/generators/safety-class.ts + src/utils/fs.ts: pristine → rewrite+backup,
// diverged → withheld whole) so the phantom promise cannot silently return, and
// gives the governance class (the two files it force-renders) a mechanical,
// code-derived pin against the doc drifting again (AC-1, AC-2).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOVERNANCE_CLASS_KEYS } from '../../src/generators/safety-class.js'

const REPO_ROOT = resolve('.')
const DOC_PATH = resolve(REPO_ROOT, 'docs/REFERENCE/file-stability.md')

function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf-8')
}

/**
 * Extract the File Map row's body for `### <heading>` — from that heading up to
 * (not including) the next `### ` or `## ` heading. Returns '' when absent.
 */
function readFileMapSection(doc: string, heading: string): string {
  const lines = doc.split('\n')
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingRe = new RegExp(`^###\\s+${escaped}\\s*$`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###\s+/.test(lines[i]) || /^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

describe('file-stability.md truth (#2447)', () => {
  it('AC-1: does not promise a custom-marker merge for AGENTS.md (no such implementation exists in src/)', () => {
    const doc = readDoc()
    expect(doc).not.toMatch(/arbiter:custom:start/)
    expect(doc).not.toMatch(/arbiter:custom:end/)
  })

  it('AC-1: describes the actual AGENTS.md mechanism — rewrite-while-pristine, withhold-once-diverged', () => {
    const section = readFileMapSection(readDoc(), 'AGENTS.md')
    expect(section).not.toBe('')
    // The real mechanism (src/generators/agents-md.ts writeFile(..., { backup: true })
    // + the governance-class predicate in src/utils/fs.ts resolveSessionSkip): a
    // pristine file is rewritten (backed up first); a diverged one is withheld whole.
    expect(section.toLowerCase()).toContain('withheld')
    expect(section.toLowerCase()).toContain('backup')
    expect(section.toLowerCase()).toContain('pristine')
  })

  it('AC-2: .claude/knowledge-map.json has a File Map row', () => {
    const section = readFileMapSection(readDoc(), '.claude/knowledge-map.json')
    expect(section).not.toBe('')
    expect(section).toMatch(/Status\s*\|/)
    expect(section).toMatch(/Merge strategy\s*\|/)
  })

  it('mechanical pin: every governance-class key (safety-class.ts GOVERNANCE_CLASS_KEYS) has a File Map row', () => {
    const doc = readDoc()
    expect(GOVERNANCE_CLASS_KEYS.size).toBeGreaterThan(0)
    for (const key of GOVERNANCE_CLASS_KEYS) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(doc, `expected a "### ${key}" File Map row for governance-class key`).toMatch(
        new RegExp(`^###\\s+${escaped}\\s*$`, 'm'),
      )
    }
  })
})
