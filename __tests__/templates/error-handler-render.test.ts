import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('error-handler.ts.ejs (#220)', () => {
  it('renders without EJS leaks', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/error-handler.ts.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('produces RFC 7807 Problem Details shape (type/title/status/detail)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/error-handler.ts.ejs', data)
    expect(rendered).toContain('type')
    expect(rendered).toContain('title')
    expect(rendered).toContain('status')
    expect(rendered).toContain('detail')
  })

  it('includes correlationId in response shape', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/error-handler.ts.ejs', data)
    expect(rendered).toContain('correlationId')
  })

  it('does not expose stack trace in response', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/error-handler.ts.ejs', data)
    expect(rendered).not.toMatch(/res\.json.*stack|stack.*res\.json/)
  })

  it('exports errorHandler function', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/error-handler.ts.ejs', data)
    expect(rendered).toContain('errorHandler')
    expect(rendered).toMatch(/export/)
  })
})

describe('correlation-id.ts.ejs (#220)', () => {
  it('renders without EJS leaks', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/correlation-id.ts.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('reads X-Correlation-ID header from request', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/correlation-id.ts.ejs', data)
    expect(rendered).toMatch(/X-Correlation-ID|x-correlation-id/i)
  })

  it('generates UUID when header absent', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/correlation-id.ts.ejs', data)
    expect(rendered).toMatch(/randomUUID|uuid|crypto/i)
  })

  it('attaches correlationId to request and response', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/correlation-id.ts.ejs', data)
    expect(rendered).toContain('correlationId')
    expect(rendered).toMatch(/res\.setHeader|response\.setHeader/)
  })

  it('exports correlationIdMiddleware function', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('middleware/correlation-id.ts.ejs', data)
    expect(rendered).toContain('correlationIdMiddleware')
    expect(rendered).toMatch(/export/)
  })
})
