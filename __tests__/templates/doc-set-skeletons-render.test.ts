// SPDX-License-Identifier: Apache-2.0
// T3 (gold-doc-tranches-t3-t5.md §1.2b) — render tests for the skeleton catalog templates
// (src/templates/docs/skeletons/*.md.ejs), satisfying the check-template-tests.mjs ratchet
// (INV-48/CANON-04). Full behavioral coverage (frontmatter, banner-upgrade, tier resolution,
// right-sizing) lives in __tests__/generators/doc-set.test.ts — this file only pins that each
// template renders without error and contains its real section headers, never lorem/a banner.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L1' })

describe('docs/skeletons/*.md.ejs render (T3)', () => {
  it.each([
    ['docs/skeletons/arc42-canvas.md.ejs', ['## Context', '## Building blocks', '## Decisions']],
    [
      'docs/skeletons/arc42-full.md.ejs',
      ['## Context', '## C4 — Context & Container', '## Building blocks'],
    ],
    ['docs/skeletons/slo.md.ejs', ['## Objectives', '## SLIs', '## Error budget']],
    [
      'docs/skeletons/threat-model-4q.md.ejs',
      ['## What are we building?', '## What can go wrong?'],
    ],
    ['docs/skeletons/threat-model-stride.md.ejs', ['## STRIDE table', 'Elevation of privilege']],
    ['docs/skeletons/er-model.md.ejs', ['## Entities', '## Relations', 'PII']],
    ['docs/skeletons/glossary.md.ejs', ['| Term | Definition | Owner |']],
    ['docs/skeletons/test-strategy.md.ejs', ['## Pyramid', '## Coverage policy']],
    ['docs/skeletons/governance.md.ejs', ['## Decision rights', '## Gate ladder']],
    ['docs/skeletons/technical-debt.md.ejs', ['| Item | Class | Interest | Plan |']],
  ] as const)(
    '%s renders with its real section headers, never a lorem/STUB banner',
    (tpl, headers) => {
      const content = renderTemplate(tpl, { ...config, title: 'x' })
      expect(content.trim().length).toBeGreaterThan(0)
      expect(content).not.toContain('STUB — fill me in')
      expect(content).not.toContain('lorem')
      for (const h of headers) expect(content).toContain(h)
    },
  )
})
