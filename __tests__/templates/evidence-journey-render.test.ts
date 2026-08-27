import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

describe('record-journey-evidence.mjs.ejs (#2382)', () => {
  it('renders a runnable, project-named recorder (AC-2382.1)', () => {
    const rendered = renderTemplate('scripts/record-journey-evidence.mjs.ejs', {
      projectName: 'example-project',
    })

    expect(rendered).toContain('example-project')
    expect(rendered).toContain('--task-id <id>')
    expect(rendered).toContain('--target artifact')
    expect(rendered).not.toContain('<%=')
  })
})
