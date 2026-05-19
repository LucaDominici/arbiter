// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for F9 API contract baseline EJS templates (#896)

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.svc',
    contractType: 'rest-owned',
    hasPublicApi: true,
    projectName: 'my-service',
    governanceLevel: 'L2',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

// ─── api-snapshots stubs ──────────────────────────────────────────────────────

const SNAPSHOT_TEMPLATES = [
  'openapi-baseline.json.ejs',
  'openapi-paths-baseline.json.ejs',
  'openapi-response-status-baseline.json.ejs',
  'openapi-content-types-baseline.json.ejs',
  'openapi-required-fields-baseline.json.ejs',
  'config-response-baseline.json.ejs',
  'config-keys-baseline.json.ejs',
  'enum-values-baseline.json.ejs',
  'error-shape-baseline.json.ejs',
  'test-snapshot.json.ejs',
]

describe('api-snapshots EJS templates — render invariants (CANON-04, #896)', () => {
  it.each(SNAPSHOT_TEMPLATES)('%s renders without EJS errors', (tpl) => {
    expect(() => renderTemplate(`contract-testing/api-snapshots/${tpl}`, makeData())).not.toThrow()
  })

  it.each(SNAPSHOT_TEMPLATES)('%s output is valid JSON', (tpl) => {
    const content = renderTemplate(`contract-testing/api-snapshots/${tpl}`, makeData())
    expect(() => JSON.parse(content), `${tpl} is not valid JSON`).not.toThrow()
  })

  it('openapi-baseline.json.ejs renders a JSON object', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/openapi-baseline.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(typeof parsed).toBe('object')
    expect(parsed).not.toBeNull()
  })

  it('openapi-paths-baseline.json.ejs renders a JSON array', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/openapi-paths-baseline.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('config-keys-baseline.json.ejs renders a JSON array', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/config-keys-baseline.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('enum-values-baseline.json.ejs renders a JSON object', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/enum-values-baseline.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(typeof parsed).toBe('object')
    expect(parsed).not.toBeNull()
    expect(Array.isArray(parsed)).toBe(false)
  })

  it('test-snapshot.json.ejs renders object with contract and version keys', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/test-snapshot.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('contract')
    expect(parsed).toHaveProperty('version')
  })

  it('error-shape-baseline.json.ejs renders object with status key', () => {
    const content = renderTemplate(
      'contract-testing/api-snapshots/error-shape-baseline.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(typeof parsed).toBe('object')
    expect(parsed).toHaveProperty('status')
  })
})

// ─── pact-samples stubs ───────────────────────────────────────────────────────

const PACT_TEMPLATES = [
  'assignment-response.json.ejs',
  'availability-response.json.ejs',
  'availability-rule-response.json.ejs',
  'capacity-response.json.ejs',
  'fully-booked-response.json.ejs',
  'schedule-override-response.json.ejs',
]

describe('pact-samples EJS templates — render invariants (CANON-04, #896)', () => {
  it.each(PACT_TEMPLATES)('%s renders without EJS errors', (tpl) => {
    expect(() => renderTemplate(`contract-testing/pact-samples/${tpl}`, makeData())).not.toThrow()
  })

  it.each(PACT_TEMPLATES)('%s output is valid JSON', (tpl) => {
    const content = renderTemplate(`contract-testing/pact-samples/${tpl}`, makeData())
    expect(() => JSON.parse(content), `${tpl} is not valid JSON`).not.toThrow()
  })

  it('assignment-response.json.ejs renders object with uuid key', () => {
    const content = renderTemplate(
      'contract-testing/pact-samples/assignment-response.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('uuid')
  })

  it('availability-response.json.ejs renders object with resources array', () => {
    const content = renderTemplate(
      'contract-testing/pact-samples/availability-response.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('resources')
    expect(Array.isArray(parsed.resources)).toBe(true)
  })

  it('capacity-response.json.ejs renders object with resources array', () => {
    const content = renderTemplate(
      'contract-testing/pact-samples/capacity-response.json.ejs',
      makeData(),
    )
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('resources')
    expect(Array.isArray(parsed.resources)).toBe(true)
  })
})

// ─── validator scripts ────────────────────────────────────────────────────────

describe('validator EJS templates — render invariants (CANON-04, #896)', () => {
  it('validate-api-snapshots.mjs.ejs renders without EJS errors', () => {
    expect(() => renderTemplate('scripts/validate-api-snapshots.mjs.ejs', makeData())).not.toThrow()
  })

  it('validate-api-snapshots.mjs.ejs contains snapshot reference', () => {
    const content = renderTemplate('scripts/validate-api-snapshots.mjs.ejs', makeData())
    expect(content.toLowerCase()).toContain('snapshot')
  })

  it('validate-api-snapshots.mjs.ejs starts with shebang or ESM import', () => {
    const content = renderTemplate('scripts/validate-api-snapshots.mjs.ejs', makeData())
    expect(content).toMatch(/^(#!\/usr\/bin\/env node|import |\/\/ SPDX)/)
  })

  it('validate-openapi-field-types.mjs.ejs renders without EJS errors', () => {
    expect(() =>
      renderTemplate('scripts/validate-openapi-field-types.mjs.ejs', makeData()),
    ).not.toThrow()
  })

  it('validate-openapi-field-types.mjs.ejs references openapi', () => {
    const content = renderTemplate('scripts/validate-openapi-field-types.mjs.ejs', makeData())
    expect(content.toLowerCase()).toContain('openapi')
  })

  it('validate-postman-collection.mjs.ejs renders without EJS errors', () => {
    expect(() =>
      renderTemplate('scripts/validate-postman-collection.mjs.ejs', makeData()),
    ).not.toThrow()
  })

  it('validate-postman-collection.mjs.ejs references postman or newman', () => {
    const content = renderTemplate('scripts/validate-postman-collection.mjs.ejs', makeData())
    expect(content.toLowerCase()).toMatch(/postman|newman/)
  })

  it('validate-postman-collection.mjs.ejs contains projectName when set', () => {
    const content = renderTemplate('scripts/validate-postman-collection.mjs.ejs', makeData())
    expect(content).toContain('my-service')
  })
})
