// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderTemplate,
  renderFromAbsPath,
  withBasePackageDefault,
} from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1348: `init --language multi` (no basePackage) crashed rc=2 because bare
// `basePackage` references in Java EJS templates throw ReferenceError under
// EJS `with(locals)` when the key is absent from the render data. The render
// boundary must guarantee `basePackage` is always a defined (own) key so each
// template renders its own authored fallback instead of throwing.

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'templates')

/** A config matching the real `--language multi` path: NO own `basePackage` key. */
function multiConfigWithoutBasePackage(): Record<string, unknown> {
  const cfg = makeConfig('/tmp/test', { language: 'multi' }) as unknown as Record<string, unknown>
  // makeConfig always sets basePackage: undefined as an own key; the real init
  // path omits the key entirely when no package is detected. Delete it to match.
  delete cfg['basePackage']
  return cfg
}

describe('#1348 — render boundary tolerates absent basePackage', () => {
  it('PactVerificationIT.java.ejs does not throw and uses its com.example fallback', () => {
    const data = multiConfigWithoutBasePackage()
    let out = ''
    expect(() => {
      out = renderTemplate('contract-testing/rest-owned/PactVerificationIT.java.ejs', data)
    }).not.toThrow()
    expect(out).toContain('package com.example.contracts;')
  })

  it('NoH2ArchTest.java.ejs does not throw and uses its relative-package fallback', () => {
    const data = multiConfigWithoutBasePackage()
    let out = ''
    expect(() => {
      out = renderTemplate('integration-testing/NoH2ArchTest.java.ejs', data)
    }).not.toThrow()
    expect(out).toContain('package architecture;')
  })

  it('preserves an explicit basePackage (regression: existing behavior unchanged)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      basePackage: 'com.acme',
    }) as unknown as Record<string, unknown>
    const out = renderTemplate('contract-testing/rest-owned/PactVerificationIT.java.ejs', data)
    expect(out).toContain('package com.acme.contracts;')
  })

  it('renderFromAbsPath (plugin path) also tolerates absent basePackage', () => {
    const abs = join(TEMPLATES_DIR, 'integration-testing', 'NoH2ArchTest.java.ejs')
    expect(() => renderFromAbsPath(abs, {})).not.toThrow()
    expect(renderFromAbsPath(abs, {})).toContain('package architecture;')
  })
})

describe('#1348 — withBasePackageDefault helper', () => {
  it('returns the same reference when basePackage key is already present', () => {
    const data = { basePackage: 'com.x', other: 1 }
    expect(withBasePackageDefault(data)).toBe(data)
  })

  it('returns the same reference when basePackage is an own undefined key', () => {
    const data = { basePackage: undefined, other: 1 }
    expect(withBasePackageDefault(data)).toBe(data)
  })

  it('adds an own basePackage=undefined key when absent, without mutating input', () => {
    const data = { other: 1 }
    const out = withBasePackageDefault(data) as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(out, 'basePackage')).toBe(true)
    expect(out['basePackage']).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(data, 'basePackage')).toBe(false)
  })
})
