// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

const BASE = { projectName: 'test-project', language: 'typescript', governanceLevel: 'L2' }

const gates = [
  {
    file: 'scripts/contract-integrity/openapi-snapshot.mjs.ejs',
    label: 'openapi-snapshot',
    keyword: 'openapi',
    issue: '#716',
  },
  {
    file: 'scripts/contract-integrity/dto-parity.mjs.ejs',
    label: 'dto-parity',
    keyword: 'dto',
    issue: '#716',
  },
  {
    file: 'scripts/contract-integrity/operation-smoke.mjs.ejs',
    label: 'operation-smoke',
    keyword: 'smoke',
    issue: '#716',
  },
  {
    file: 'scripts/contract-integrity/dead-code.mjs.ejs',
    label: 'dead-code',
    keyword: 'dead',
    issue: '#716',
  },
  {
    file: 'scripts/contract-integrity/test-hygiene.mjs.ejs',
    label: 'test-hygiene',
    keyword: 'hygiene',
    issue: '#716',
  },
]

for (const { file, label, keyword, issue } of gates) {
  describe(`${file} render (${issue})`, () => {
    const render = () => renderTemplate(file, BASE)

    it(`${label}: renders without throwing`, () => {
      expect(() => render()).not.toThrow()
    })

    it(`${label}: output contains ${keyword}`, () => {
      expect(render().toLowerCase()).toContain(keyword)
    })

    it(`${label}: exit-code contract comment present (INV-53)`, () => {
      const out = render()
      // Generated scripts must document the full 0=PASS/1=FAIL/2=ERROR contract
      expect(out).toMatch(/0\s*[=:]\s*pass/i)
      expect(out).toMatch(/1\s*[=:]\s*fail/i)
      expect(out).toMatch(/2\s*[=:]\s*(error|skip)/i)
    })
  })
}
