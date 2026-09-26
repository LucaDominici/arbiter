// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #2917 CUT: the two phantom citations are removed at the source, so the doc gates pass
// with no #2917 excuse in scripts/data/doc-gate-allowlist.json.
describe('#2917 phantom citations removed, allowlist excuses gone', () => {
  it('the governance playbook no longer documents `arbiter audit run`', () => {
    const out = renderTemplate(
      'governance/qa-audit-phases.md.ejs',
      makeConfig('/tmp/test') as unknown as Record<string, unknown>,
    )
    expect(out).not.toMatch(/arbiter audit run/)
  })

  it('gdpr-overlay.md no longer cites the consumer-only gate path literally', () => {
    const doc = readFileSync('docs/REFERENCE/gdpr-overlay.md', 'utf-8')
    expect(doc).not.toMatch(/scripts\/check-gdpr-controls\.mjs/)
  })

  it('doc-gate-allowlist.json carries no #2917 entry', () => {
    const list = JSON.parse(readFileSync('scripts/data/doc-gate-allowlist.json', 'utf-8')) as {
      entries: { issue: string }[]
    }
    expect(list.entries.filter((e) => e.issue === '#2917')).toEqual([])
  })
})
