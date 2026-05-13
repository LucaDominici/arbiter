import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('drift-shadow.yml.ejs rendering (#470)', () => {
  it('renders nightly schedule cron', () => {
    const data = makeConfig('/tmp/test', {
      enableSoloDevMode: true,
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/drift-shadow.yml.ejs', data)
    expect(rendered).toContain('cron:')
    expect(rendered).toContain('0 3 * * *')
  })

  it('references INV-59 drift check', () => {
    const data = makeConfig('/tmp/test', {
      enableSoloDevMode: true,
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/drift-shadow.yml.ejs', data)
    expect(rendered).toContain('INV-59')
    expect(rendered).toContain('check-local-ci-parity.mjs')
  })

  it('opens GitHub issue on drift', () => {
    const data = makeConfig('/tmp/test', {
      enableSoloDevMode: true,
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/drift-shadow.yml.ejs', data)
    expect(rendered).toContain('inv-59-drift')
    expect(rendered).toContain('github.rest.issues.create')
  })
})
