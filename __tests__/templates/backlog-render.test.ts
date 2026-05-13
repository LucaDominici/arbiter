import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

function render(): string {
  return renderTemplate('evidence/BACKLOG.md.ejs', {
    projectName: 'test-project',
  })
}

describe('evidence/BACKLOG.md.ejs render (#243)', () => {
  it('renders without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('output is at most 50 lines', () => {
    const lines = render().split('\n')
    expect(lines.length).toBeLessThanOrEqual(50)
  })

  it('contains Open questions section', () => {
    expect(render()).toContain('Open questions')
  })

  it('contains Decisions section', () => {
    expect(render()).toContain('Decisions')
  })

  it('contains Dead ends section', () => {
    expect(render()).toContain('Dead ends')
  })

  it('contains Next actions section', () => {
    expect(render()).toContain('Next actions')
  })
})
