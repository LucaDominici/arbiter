// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const data = makeConfig('/tmp/test', {
  enableFiveLaneCi: true,
  useGitHub: true,
}) as unknown as Record<string, unknown>

describe('five-lane/ci.yml.ejs rendering (A1 — PR-blocking tier)', () => {
  it('carries the tier + time budget in a header comment', () => {
    const rendered = renderTemplate('github/workflows/five-lane/ci.yml.ejs', data)
    expect(rendered).toMatch(/tier — PR-blocking/)
    expect(rendered).toMatch(/<=15min/)
    expect(rendered).toContain('INV-136')
  })

  it('declares top-level permissions and a cancellable concurrency group', () => {
    const rendered = renderTemplate('github/workflows/five-lane/ci.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
    expect(rendered).toMatch(/^concurrency:/m)
    expect(rendered).toContain('cancel-in-progress: true')
  })

  it('runs the L2 gate', () => {
    const rendered = renderTemplate('github/workflows/five-lane/ci.yml.ejs', data)
    expect(rendered).toContain('node scripts/check-all.mjs L2')
  })
})

describe('five-lane/nightly.yml.ejs rendering (A1 — nightly tier, A6 sticky issue)', () => {
  it('carries the tier + time budget in a header comment', () => {
    const rendered = renderTemplate('github/workflows/five-lane/nightly.yml.ejs', data)
    expect(rendered).toMatch(/tier — nightly/)
    expect(rendered).toMatch(/<=45min/)
  })

  it('is schedule-triggered and non-cancellable', () => {
    const rendered = renderTemplate('github/workflows/five-lane/nightly.yml.ejs', data)
    expect(rendered).toContain('schedule:')
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it('invokes the sticky-failure-issue script on failure and on success', () => {
    const rendered = renderTemplate('github/workflows/five-lane/nightly.yml.ejs', data)
    expect(rendered).toContain('.github/scripts/sticky-failure-issue.sh record nightly')
    expect(rendered).toContain('.github/scripts/sticky-failure-issue.sh close nightly')
  })

  it('grants issues: write for the sticky-issue mechanism', () => {
    const rendered = renderTemplate('github/workflows/five-lane/nightly.yml.ejs', data)
    expect(rendered).toMatch(/issues:\s*write/)
  })
})

describe('five-lane/weekly.yml.ejs rendering (A1 — weekly tier, A6 sticky issue)', () => {
  it('carries the tier + unbounded budget in a header comment', () => {
    const rendered = renderTemplate('github/workflows/five-lane/weekly.yml.ejs', data)
    expect(rendered).toMatch(/tier — weekly/)
    expect(rendered).toMatch(/unbounded/)
  })

  it('invokes the sticky-failure-issue script on failure and on success', () => {
    const rendered = renderTemplate('github/workflows/five-lane/weekly.yml.ejs', data)
    expect(rendered).toContain('.github/scripts/sticky-failure-issue.sh record weekly')
    expect(rendered).toContain('.github/scripts/sticky-failure-issue.sh close weekly')
  })

  it('runs the L4 gate', () => {
    const rendered = renderTemplate('github/workflows/five-lane/weekly.yml.ejs', data)
    expect(rendered).toContain('node scripts/check-all.mjs L4')
  })
})

describe('five-lane/release.yml.ejs rendering (A1 — release-seal tier)', () => {
  it('carries the tier in a header comment and triggers on tag push', () => {
    const rendered = renderTemplate('github/workflows/five-lane/release.yml.ejs', data)
    expect(rendered).toMatch(/tier — release-seal/)
    expect(rendered).toContain("tags: ['v*']")
  })

  it('does not invoke the sticky-failure-issue script (release lane is not scheduled)', () => {
    const rendered = renderTemplate('github/workflows/five-lane/release.yml.ejs', data)
    expect(rendered).not.toContain('sticky-failure-issue.sh')
  })
})

describe('five-lane templates — SHA-pinned actions (INV-76 parity)', () => {
  const files = [
    'github/workflows/five-lane/ci.yml.ejs',
    'github/workflows/five-lane/nightly.yml.ejs',
    'github/workflows/five-lane/weekly.yml.ejs',
    'github/workflows/five-lane/release.yml.ejs',
  ]

  it.each(files)('%s pins actions/checkout to a 40-hex SHA', (file) => {
    const rendered = renderTemplate(file, data)
    expect(rendered).toMatch(/actions\/checkout@[0-9a-f]{40}/)
  })
})
