// SPDX-License-Identifier: Apache-2.0
// #2272 — boundaries/eslint.config.boundaries.mjs.ejs (flat config, ESLint v9) and
// boundaries/check-boundaries.mjs.ejs (the script that invokes it in isolation via
// --config/--no-config-lookup). Mirrors the frontend-spa flat-config precedent
// (#1127/#1491): ESLint v9 removed the legacy --no-eslintrc/-c loader the .cjs
// file needs, so the gate runs this flat config instead.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(template: string): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    architectureStyle: 'hexagonal',
  }) as unknown as Record<string, unknown>
  return renderTemplate(template, data)
}

describe('boundaries/eslint.config.boundaries.mjs.ejs (#2272)', () => {
  const out = render('boundaries/eslint.config.boundaries.mjs.ejs')

  it('renders cleanly with no leftover EJS tags', () => {
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('carries the hexagonal element-types and external rules', () => {
    expect(out).toContain('boundaries/element-types')
    expect(out).toContain('boundaries/external')
    expect(out).toContain('domain')
    expect(out).toContain('application')
    expect(out).toContain('adapters')
    expect(out).toContain('infrastructure')
  })

  it('configures an import/resolver so relative .ts imports classify (not "unknown")', () => {
    // Without this, eslint-plugin-boundaries' bundled eslint-import-resolver-node
    // cannot resolve extensionless relative imports to a .ts file, and every
    // legitimate cross-layer import false-positives on boundaries/no-unknown.
    expect(out).toContain("'import/resolver'")
    expect(out).toContain(".ts', '.tsx'")
  })
})

describe('boundaries/check-boundaries.mjs.ejs runs the flat config in isolation (#2272, B4 #1491-class)', () => {
  const out = render('boundaries/check-boundaries.mjs.ejs')

  it('invokes eslint --config eslint.config.boundaries.mjs --no-config-lookup', () => {
    expect(out).toContain("'--config'")
    expect(out).toContain('eslint.config.boundaries.mjs')
    expect(out).toContain("'--no-config-lookup'")
  })

  it('never passes the legacy --no-eslintrc/-c flags (ESLint v9 removed them)', () => {
    expect(out).not.toContain("'--no-eslintrc'")
    expect(out).not.toContain("'-c', '.eslintrc-boundaries.cjs'")
  })
})
