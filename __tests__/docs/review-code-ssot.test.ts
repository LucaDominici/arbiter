// SPDX-License-Identifier: Apache-2.0
// #2231 (wave-3 Group E) — /review-code dispatch SSOT. The tier table (3/3/5) and
// 5-persona list hardcoded in .claude/commands/review-code.md drifted from
// .claude/agent-dispatch-matrix.json::tier_verticals (XS=3, S=4, Standard=7) and the
// auditor registry in .claude/auditor-routing.json. These assertions pin the doc to
// the SSOT pointers, the --size-floor invocation, the post-dispatch completion check,
// and the absence of the phantom `arbiter review code` citations (multi-pass dispatch
// removed in #1817).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const doc = readFileSync(resolve('.claude/commands/review-code.md'), 'utf-8')

describe('.claude/commands/review-code.md — dispatch SSOT (AC-2231.1-4)', () => {
  it('no hardcoded 3/3/5 tier table — replaced by a pointer to agent-dispatch-matrix.json::tier_verticals', () => {
    expect(doc).not.toMatch(/\| XS\s+\|/)
    expect(doc).not.toMatch(/\| S\s+\|/)
    expect(doc).not.toMatch(/\| Standard\s+\|/)
    expect(doc).toContain('agent-dispatch-matrix.json')
    expect(doc).toContain('tier_verticals')
  })

  it('no hardcoded 5-persona list — the auditor roster is read from auditor-routing.json', () => {
    expect(doc).not.toMatch(/^## Personas/m)
    expect(doc).not.toMatch(/\*\*bugs\*\*/)
    expect(doc).not.toMatch(/\*\*silent-failure-hunter\*\*/)
    expect(doc).toContain('auditor-routing.json')
  })

  it('documented route-auditors invocation passes --size-floor <tier>', () => {
    expect(doc).toContain('--size-floor')
  })

  it('post-dispatch completion check documented: every persona must return a verdict, one retry otherwise', () => {
    expect(doc).toMatch(/every persona/i)
    expect(doc).toMatch(/retry/i)
  })

  it('no phantom `arbiter review code` citation remains (multi-pass dispatch removed in #1817)', () => {
    expect(doc).not.toContain('arbiter review code')
  })
})
