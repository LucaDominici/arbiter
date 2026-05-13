import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('seed-test-data.sh.ejs rendering (CANON-04)', () => {
  const data = makeConfig('/tmp/test', {
    archetype: 'backend-web-db',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('renders with strict mode and portable sha256 probe', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).toContain('set -euo pipefail')
    expect(content).toContain('sha256sum')
    expect(content).toContain('shasum')
  })

  it('contains gen_uuid function', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).toContain('gen_uuid')
    expect(content).toContain('sha256')
  })

  it('contains idempotency: 409 skip logic', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).toContain('409')
  })

  it('contains JWT expiry check function', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).toContain('check_jwt_expiry')
    expect(content).toContain('exp')
  })

  it('sources seed-common.sh', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).toContain('seed-common.sh')
  })

  it('has no unrendered EJS tags', () => {
    const content = renderTemplate('scripts/seed-test-data.sh.ejs', data)
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

describe('seed-common.sh.ejs rendering (CANON-04)', () => {
  const data = makeConfig('/tmp/test', {
    archetype: 'backend-web-db',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>

  it('exports gen_uuid helper', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).toContain('gen_uuid')
  })

  it('exports http_post and http_get helpers', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).toContain('http_post')
    expect(content).toContain('http_get')
  })

  it('exports check_jwt_expiry helper', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).toContain('check_jwt_expiry')
  })

  it('exports check_connectivity and date_offset helpers', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).toContain('check_connectivity')
    expect(content).toContain('date_offset')
  })

  it('uses LAST_HTTP_STATUS / LAST_HTTP_BODY global vars (no subshells)', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).toContain('LAST_HTTP_STATUS')
    expect(content).toContain('LAST_HTTP_BODY')
  })

  it('has no unrendered EJS tags', () => {
    const content = renderTemplate('scripts/lib/seed-common.sh.ejs', data)
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})
