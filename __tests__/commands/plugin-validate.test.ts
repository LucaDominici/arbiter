// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { validatePluginPackageJson } from '../../src/integrations/plugin-schema.js'

describe('validatePluginPackageJson (#570)', () => {
  const VALID_PKG = {
    name: 'arbiter-plugin-spring-boot',
    version: '0.1.0',
    keywords: ['arbiter', 'arbiter-plugin'],
    main: 'dist/index.js',
    peerDependencies: { '@arbiter/cli': '*' },
  }

  it('passes a valid plugin package.json', () => {
    const result = validatePluginPackageJson(VALID_PKG)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails when arbiter-plugin keyword is missing', () => {
    const result = validatePluginPackageJson({ ...VALID_PKG, keywords: ['arbiter'] })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails when version is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version: _v, ...rest } = VALID_PKG
    const result = validatePluginPackageJson(rest)
    expect(result.ok).toBe(false)
  })

  it('fails when keywords array is absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keywords: _k, ...rest } = VALID_PKG
    const result = validatePluginPackageJson(rest)
    expect(result.ok).toBe(false)
  })

  it('fails when name is not a valid npm package name', () => {
    const result = validatePluginPackageJson({ ...VALID_PKG, name: 'INVALID NAME!' })
    expect(result.ok).toBe(false)
  })
})
