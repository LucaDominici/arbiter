// SPDX-License-Identifier: Apache-2.0
// INV-48 (CANON-04) render coverage for the live-API e2e templates (#1365, INV-126).
// Lives under __tests__/templates/ so the check-template-tests.mjs ratchet counts
// each api-e2e/*.ejs as tested. Every template must render without throwing.
import { describe, it, expect } from 'vitest'
import { makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

// Reference each template by its full relPath so the ratchet marks it tested.
// Suite/runner/README templates render from a ProjectConfig.
const SUITE_TEMPLATES = [
  'api-e2e/ts-supertest.test.ts.ejs',
  'api-e2e/go-httptest.go.ejs',
  'api-e2e/java-restassured.java.ejs',
  'api-e2e/kotlin-restassured.kt.ejs',
  'api-e2e/python-httpx.py.ejs',
  'api-e2e/postman.collection.json.ejs',
  'api-e2e/run.sh.ejs',
  'api-e2e/README.md.ejs',
]

describe('api-e2e templates render (INV-48, CANON-04)', () => {
  it.each(SUITE_TEMPLATES)('%s renders without throwing', (tpl) => {
    const rendered = renderTemplate(tpl, {
      ...makeConfig('/tmp/render-api-e2e-tpl', {
        language: 'go',
        archetype: 'backend-web-db',
        basePackage: 'com.example',
      }),
    } as unknown as Record<string, unknown>)
    expect(rendered.length).toBeGreaterThan(20)
  })

  it('api-e2e/manifest.json.ejs renders valid JSON from manifest data', () => {
    const rendered = renderTemplate('api-e2e/manifest.json.ejs', {
      archetype: 'backend-web-db',
      required: true,
      suiteDir: 'tests/api',
      framework: 'supertest',
      glob: 'tests/api/**/*.test.ts',
      suiteCount: 1,
    })
    const parsed = JSON.parse(rendered)
    expect(parsed.required).toBe(true)
    expect(parsed.glob).toBe('tests/api/**/*.test.ts')
    expect(parsed.suiteCount).toBe(1)
  })

  it('go run.sh template emits the go build + boot path', () => {
    const rendered = renderTemplate('api-e2e/run.sh.ejs', {
      ...makeConfig('/tmp/render-api-e2e-go', { language: 'go', archetype: 'backend-web-db' }),
    } as unknown as Record<string, unknown>)
    expect(rendered).toMatch(/go build/)
    expect(rendered).toMatch(/#!\/usr\/bin\/env bash/)
  })
})
