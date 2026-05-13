import { describe, it, expect } from 'vitest'
import { renderString } from '../../src/utils/render.js'

describe('renderString', () => {
  it('interpolates variables', () => {
    const result = renderString('Hello <%= name %>', { name: 'World' })
    expect(result).toBe('Hello World')
  })

  it('handles conditional blocks', () => {
    const template = '<% if (show) { %>visible<% } else { %>hidden<% } %>'
    expect(renderString(template, { show: true })).toBe('visible')
    expect(renderString(template, { show: false })).toBe('hidden')
  })

  it('handles array iteration', () => {
    const template = '<% items.forEach(i => { %><%= i %> <% }) %>'
    const result = renderString(template, { items: ['a', 'b', 'c'] })
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })

  it('handles undefined variables with default', () => {
    const template = '<%= typeof name !== "undefined" ? name : "default" %>'
    expect(renderString(template, {})).toBe('default')
  })

  it('renders empty string for empty template', () => {
    expect(renderString('', {})).toBe('')
  })

  it('passes through plain text unchanged', () => {
    expect(renderString('no variables here', {})).toBe('no variables here')
  })

  it('handles nested object access', () => {
    const template = '<%= config.level %>'
    expect(renderString(template, { config: { level: 'L2' } })).toBe('L2')
  })
})
