import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('12-mutation-scheduled.yml.ejs rendering (CANON-04, #1076)', () => {
  it('renders scheduled cron trigger', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('cron:')
    expect(rendered).toContain('0 3 * * 1')
  })

  it('has top-level permissions block', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('renders Java PITest block for java+gradle', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('pitest')
    expect(rendered).toContain('setup-gradle')
  })

  it('all action refs are SHA-pinned (java+gradle)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })
})
