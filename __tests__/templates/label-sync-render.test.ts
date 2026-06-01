// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1131 slice 3: _label-sync must honour a DISABLE_LABEL_SYNC opt-out so a repo
// that manages its own label taxonomy is not additively injected with the
// canonical labels.yml set.

function render(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_label-sync.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('_label-sync.yml.ejs — opt-out guard (CANON-18, #1131)', () => {
  it('sync job is gated on the DISABLE_LABEL_SYNC repo variable', () => {
    const rendered = render()
    expect(rendered).toContain("if: ${{ vars.DISABLE_LABEL_SYNC != 'true' }}")
  })

  it('still triggers on labels.yml pushes to main and applies labels', () => {
    const rendered = render()
    expect(rendered).toContain('.github/labels.yml')
    expect(rendered).toContain('gh')
    expect(rendered).toContain('label')
  })
})
