import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('13-archunit-extended.yml.ejs rendering (CANON-04, #1076)', () => {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders scheduled ArchUnit job', () => {
    const rendered = renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data)
    expect(rendered).toContain('ArchUnit')
    expect(rendered).toContain('cron:')
  })

  it('has top-level permissions block', () => {
    const rendered = renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('renders Gradle setup for java+gradle', () => {
    const rendered = renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data)
    expect(rendered).toContain('setup-gradle')
    expect(rendered).toContain('ArchTest')
  })

  it('all action refs are SHA-pinned', () => {
    const rendered = renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })
})
