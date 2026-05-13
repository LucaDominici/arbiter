import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('issue-state.yml.ejs rendering', () => {
  it('renders the update-state job', () => {
    const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/issue-state.yml.ejs', data)
    expect(rendered).toContain('update-state')
    expect(rendered).toContain('Issue State Automation')
  })

  it('includes all three state transitions', () => {
    const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/issue-state.yml.ejs', data)
    expect(rendered).toContain('Extract linked issue number')
    expect(rendered).toContain('→ In Review')
    expect(rendered).toContain('→ Done')
  })

  it('uses env: for PR body (no direct interpolation)', () => {
    const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/issue-state.yml.ejs', data)
    expect(rendered).toContain('PR_BODY: ${{ github.event.pull_request.body }}')
    expect(rendered).toContain('process.env.PR_BODY')
  })

  it('uses CI_BUILD_RUNNER_LABEL runner variable', () => {
    const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/issue-state.yml.ejs', data)
    expect(rendered).toContain('CI_BUILD_RUNNER_LABEL')
  })
})
