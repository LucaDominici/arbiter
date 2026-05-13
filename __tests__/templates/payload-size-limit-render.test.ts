import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('payload-size-limit.ts.ejs rendering (CANON-04)', () => {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    hasPublicApi: true,
  }) as unknown as Record<string, unknown>

  it('exports payloadSizeLimit middleware function', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('payloadSizeLimit')
  })

  it('uses 1_048_576 as default byte limit', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('1_048_576')
  })

  it('reads MAX_REQUEST_BYTES env var as override', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('MAX_REQUEST_BYTES')
  })

  it('emits 413 status code', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('413')
  })

  it('emits RFC 7807 problem-type/payload-too-large type URI', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('problem-type/payload-too-large')
  })

  it('documents Transfer-Encoding chunked limitation', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('Transfer-Encoding')
  })

  it('emits application/problem+json Content-Type (RFC 7807)', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('application/problem+json')
  })

  it('guards MAX_REQUEST_BYTES with isFinite check (no NaN/zero-length bypass)', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).toContain('isFinite')
  })

  it('has no unrendered EJS tags', () => {
    const content = renderTemplate('middleware/payload-size-limit.ts.ejs', data)
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})
