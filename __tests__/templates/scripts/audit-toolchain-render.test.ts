// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

describe('audit-toolchain.mjs.ejs', () => {
  it('renders without EJS leaks', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('starts with a Node shebang', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    expect(out.trimStart()).toMatch(/^#!\/usr\/bin\/env node/)
  })

  it('contains project name in comment', () => {
    const out = renderTemplate(
      'scripts/audit-toolchain.mjs.ejs',
      cfg({ projectName: 'my-project' }),
    )
    expect(out).toContain('my-project')
  })

  // #1835: workflow-file checks are useGitHub-gated (a non-GitHub project would
  // otherwise false-FAIL on workflow files that were never applicable).
  it('checks .github/workflows directory when GitHub is on', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg({ useGitHub: true }))
    expect(out).toContain('.github/workflows')
  })

  it('checks gate scripts exist', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    expect(out).toContain('check-all.mjs')
  })

  it('checks CLI buildability', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    expect(out).toContain('build')
  })

  it('exits 1 on any fail, 0 on all pass', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    // Script uses ternary: process.exit(failed > 0 ? 1 : 0)
    expect(out).toContain('process.exit(')
    expect(out).toMatch(/process\.exit\(.*\b1\b/)
    expect(out).toMatch(/process\.exit\(.*\b0\b/)
  })

  it('reports pass/fail per check', () => {
    const out = renderTemplate('scripts/audit-toolchain.mjs.ejs', cfg())
    expect(out).toContain('PASS')
    expect(out).toContain('FAIL')
  })
})
