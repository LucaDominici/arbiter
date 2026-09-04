// SPDX-License-Identifier: Apache-2.0
// __tests__/docs/surface-truth-2417.test.ts
// #2417: batch of "self-only surfaces leak into product promises" doc corrections
// named in the issue — each assertion below traces to one sentence flagged there.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractTopLevelCommandNames } from '../../scripts/lib/cli-command-names.mjs'

describe('docs/technical-debt.md — --governance lives on `diff`, not `update` (#2417)', () => {
  it('cites `arbiter diff --governance`, never `arbiter update --governance`', () => {
    const src = readFileSync(resolve('docs/technical-debt.md'), 'utf-8')
    expect(src).not.toContain('arbiter update --governance')
    expect(src).toContain('arbiter diff --governance')
  })
})

describe('docs/CONTRIBUTING.md — Node 22 minimum everywhere (#2417)', () => {
  it('does not claim Node 20 as the minimum (package.json engines is >=22)', () => {
    const src = readFileSync(resolve('docs/CONTRIBUTING.md'), 'utf-8')
    expect(src).not.toMatch(/Node(?:\.js)?\s*(?:>=|≥)?\s*20\b.*minimum/i)
    expect(src).not.toContain('Node.js >= 20')
  })

  it('states Node >= 22 as the requirement, matching package.json engines', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
    expect(pkg.engines.node).toBe('>=22.0.0')
    const src = readFileSync(resolve('docs/CONTRIBUTING.md'), 'utf-8')
    expect(src).toMatch(/Node\.js\s*(?:>=|≥)\s*22/)
  })
})

describe('website/reference/cli.md — hidden commands labelled hidden (#2417 AC-3)', () => {
  it('every hidden command (per cli.ts commander metadata) that is also hand-documented outside the generated marker region carries a hidden label', () => {
    const cliSrc = readFileSync(resolve('src/cli.ts'), 'utf-8')
    const { hiddenNames } = extractTopLevelCommandNames(cliSrc)

    const docSrc = readFileSync(resolve('website/reference/cli.md'), 'utf-8')
    const markerIdx = docSrc.indexOf('<!-- BEGIN GENERATED:cli -->')
    const handWritten = markerIdx === -1 ? docSrc : docSrc.slice(0, markerIdx)

    for (const name of hiddenNames) {
      const headingRe = new RegExp(
        '^## `arbiter ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`',
        'm',
      )
      const m = headingRe.exec(handWritten)
      if (m === null) continue // not hand-documented outside the marker — nothing to label
      const sectionEnd = handWritten.indexOf('\n---', m.index)
      const section = handWritten.slice(m.index, sectionEnd === -1 ? undefined : sectionEnd)
      expect(section.toLowerCase()).toContain('hidden')
    }
  })
})

describe('scripts/canon01-self-only.json — no entry contradicts itself (#2417)', () => {
  // #2417 caught ONE entry (check-acceptance.mjs) claiming in the same breath that no issue
  // tracked its follow-up and that an issue tracked it. #2405 removed that entry outright by
  // emitting the gate (ADR-110's follow-up is closed), so the original single-entry assertion
  // has no subject left. The guard is kept and WIDENED to the whole registry rather than
  // deleted: the contradiction class is a property of any reason text, not of one path.
  it('does not simultaneously claim "no issue tracks" the follow-up and cite one that does', () => {
    const doc = JSON.parse(readFileSync(resolve('scripts/canon01-self-only.json'), 'utf-8')) as {
      selfOnly: Array<{ path: string; reason: string }>
    }
    const contradictory = doc.selfOnly
      .filter(
        (e) =>
          /no (?:open )?issue (?:currently )?tracks/i.test(e.reason) && /tracked by/i.test(e.reason),
      )
      .map((e) => e.path)
    expect(contradictory).toEqual([])
  })

  it('no longer carries a check-acceptance.mjs entry — the ADR-110 gate is emitted (#2405)', () => {
    const doc = JSON.parse(readFileSync(resolve('scripts/canon01-self-only.json'), 'utf-8')) as {
      selfOnly: Array<{ path: string }>
    }
    expect(doc.selfOnly.map((e) => e.path)).not.toContain('scripts/check-acceptance.mjs')
  })
})

describe('configure SKILL.md.ejs example uses an accepted --tools value (#2417)', () => {
  it('the `configure --set tools=` example cites only claude/codex (ADR-095 customer-facing set)', () => {
    const src = readFileSync(resolve('src/templates/claude/skills/configure/SKILL.md.ejs'), 'utf-8')
    const m = /--set tools=([a-z,]+)/.exec(src)
    expect(m).not.toBeNull()
    const tools = (m?.[1] ?? '').split(',')
    for (const tool of tools) {
      expect(['claude', 'codex']).toContain(tool)
    }
  })
})
