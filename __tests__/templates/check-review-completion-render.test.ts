// SPDX-License-Identifier: Apache-2.0
// CANON-04 render/parity coverage for the #2177 task-scoped review-completion gate.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'scripts/check-review-completion.mjs.ejs'

function render(): string {
  return renderTemplate(
    TEMPLATE,
    makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<string, unknown>,
  )
}

describe('scripts/check-review-completion.mjs.ejs (#2177, CANON-04)', () => {
  it('renders an executable gate with the CATALOG fold-in rationale', () => {
    const rendered = render()
    expect(rendered).toMatch(/^#!\/usr\/bin\/env node/)
    expect(rendered).toContain('// CATALOG: #2177 task-scoped review-completion stage gate.')
    expect(rendered).toContain(
      'check-agent-return.mjs because that is a repo-wide CORPUS validator',
    )
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('carries the soft-completion and single-retry contract', () => {
    const rendered = render()
    expect(rendered).toContain(
      'budget but wrote its envelope PASSES and must never be re-dispatched',
    )
    expect(rendered).toContain('Re-dispatch ONLY the named agent(s) exactly once')
    expect(rendered).toContain('sidecar.agents')
  })

  it('is byte-identical to the self-dogfooded gate', () => {
    expect(render()).toBe(
      readFileSync(
        resolve(import.meta.dirname, '../../scripts/check-review-completion.mjs'),
        'utf8',
      ),
    )
  })
})
